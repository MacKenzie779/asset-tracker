#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod i18n;
mod pdf;

use serde::{Deserialize, Serialize};
use sqlx::Arguments;
use sqlx::{
    sqlite::{SqliteArguments, SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use tauri::{Manager, State, AppHandle};

/* ---------- Accounts & Transactions ---------- */
#[derive(Debug, Serialize, sqlx::FromRow)]
struct AccountOut {
    id: i64,
    name: String,
    color: Option<String>,
    #[sqlx(rename = "account_type")]
    #[serde(rename = "type")]
    r#type: String, // "standard" | "person"
    balance: f64,
}

#[derive(Debug, Serialize, sqlx::FromRow, Clone)]
struct TransactionOut {
    id: i64,
    account_id: i64,
    account_name: String,
    account_color: Option<String>,
    date: String,
    category: Option<String>,
    description: Option<String>,
    amount: f64,
    /// Both legs of a transfer share the id of the source leg.
    transfer_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct NewTransaction {
    account_id: i64,
    date: String, // YYYY-MM-DD
    description: Option<String>,
    amount: f64,
    category: Option<String>,
}

/// A transfer between two accounts: `amount` leaves `from_account_id` and arrives at `to_account_id`.
/// `category` records what the money was for (e.g. the expense paid for a person);
/// it defaults to "Transfer" for plain moves between your own accounts.
#[derive(Debug, Deserialize)]
struct NewTransfer {
    from_account_id: i64,
    to_account_id: i64,
    date: String, // YYYY-MM-DD
    amount: f64,
    description: Option<String>,
    category: Option<String>,
}

#[derive(Debug, Serialize)]
struct TransferIds {
    from_id: i64,
    to_id: i64,
}

#[derive(Debug, Deserialize)]
struct UpdateTransaction {
    id: i64,
    account_id: Option<i64>,
    date: Option<String>,
    description: Option<String>,
    amount: Option<f64>,
    category: Option<String>,
}

/* ---------- Search / Export DTOs ---------- */
#[derive(Debug, Deserialize)]
struct TxSearch {
    query: Option<String>,
    account_id: Option<i64>,
    date_from: Option<String>, // inclusive, YYYY-MM-DD
    date_to: Option<String>,   // inclusive, YYYY-MM-DD
    tx_type: Option<String>,   // "all" | "income" | "expense" | "transfer"
    limit: Option<i64>,
    offset: Option<i64>,      // if < 0 => compute last page on server
    sort_by: Option<String>,  // "date"|"category"|"description"|"amount"|"account"|"id"
    sort_dir: Option<String>, // "asc"|"desc"
}

#[derive(Debug, Serialize)]
struct TxSearchResult {
    items: Vec<TransactionOut>,
    total: i64,
    offset: i64,
    /// Income and expense exclude transfers and initial balances.
    sum_income: f64,
    sum_expense: f64,
    /// Initial balances ("Init") in the filtered set.
    sum_init: f64,
    /// Net of transfer legs in the filtered set (0 when viewing all accounts).
    sum_transfer: f64,
}

/* ---------- Categories (DB-level unique) ---------- */
#[derive(Debug, Serialize, sqlx::FromRow)]
struct Category {
    id: i64,
    name: String,
}

async fn get_or_create_category_id(
    pool: &SqlitePool,
    name_opt: Option<String>,
) -> Result<Option<i64>, sqlx::Error> {
    let name = match name_opt.map(|s| s.trim().to_string()) {
        Some(s) if !s.is_empty() => s,
        _ => return Ok(None),
    };
    sqlx::query("INSERT OR IGNORE INTO categories(name) VALUES (?)")
        .bind(&name)
        .execute(pool)
        .await?;
    let rec = sqlx::query("SELECT id FROM categories WHERE name = ? COLLATE NOCASE")
        .bind(&name)
        .fetch_one(pool)
        .await?;
    Ok(Some(rec.get::<i64, _>(0)))
}

/* ---------- Finance commands ---------- */
#[derive(Debug, Deserialize)]
struct NewAccountInput {
    name: String,
    color: Option<String>,
    account_type: String, // "standard" | "person"
    initial_balance: Option<f64>,
}

#[tauri::command]
async fn add_account(state: State<'_, AppState>, input: NewAccountInput) -> Result<i64, String> {
    let pool = current_pool(&state).await;

    let account_type = match input.account_type.trim().to_lowercase().as_str() {
        "standard" | "" => "standard",
        // "reimbursable" is the pre-2.0 name of a person account
        "person" | "reimbursable" => "person",
        other => return Err(format!("Unknown account type '{other}'")),
    };

    let rec = sqlx::query("INSERT INTO accounts (name, color, type) VALUES (?1, ?2, ?3);")
        .bind(&input.name)
        .bind(&input.color)
        .bind(account_type)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let account_id = rec.last_insert_rowid();

    if let Some(amount) = input.initial_balance {
        if amount != 0.0 {
            let date = chrono::Local::now().format("%Y-%m-%d").to_string();

            // ensure "Init" category exists and get its id
            let cat_id = get_or_create_category_id(&pool, Some("Init".to_string()))
                .await
                .map_err(|e| e.to_string())?;

            sqlx::query(
                r#"
          INSERT INTO transactions (account_id, date, description, amount, category_id)
          VALUES (?1, ?2, ?3, ?4, ?5);
        "#,
            )
            .bind(account_id)
            .bind(date)
            .bind("Initial balance")
            .bind(amount)
            .bind(cat_id) // <-- set category "Init"
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(account_id)
}

#[tauri::command]
async fn list_accounts(state: State<'_, AppState>) -> Result<Vec<AccountOut>, String> {
    let pool = current_pool(&state).await;

    sqlx::query_as::<_, AccountOut>(
        r#"
    SELECT
      a.id,
      a.name,
      a.color,
      a.type AS account_type,
      COALESCE(SUM(t.amount), 0.0) AS balance
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id
    GROUP BY a.id, a.name, a.color, a.type
    ORDER BY a.name COLLATE NOCASE ASC;
    "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())
}

/* ---------- list_transactions (Home) ordered by newest first ---------- */
#[tauri::command]
async fn list_transactions(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<TransactionOut>, String> {
    let lim = limit.unwrap_or(20);
    let pool = current_pool(&state).await;

    sqlx::query_as::<_, TransactionOut>(
        r#"
    SELECT
      t.id,
      t.account_id,
      a.name  AS account_name,
      a.color AS account_color,
      t.date,
      c.name AS category,
      t.description,
      t.amount,
      t.transfer_id
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    ORDER BY DATE(t.date) DESC, t.id DESC
    LIMIT ?1;
    "#,
    )
    .bind(lim)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())
}

/* ---------- CRUD ---------- */
#[tauri::command]
async fn add_transaction(state: State<'_, AppState>, input: NewTransaction) -> Result<i64, String> {
    let pool = current_pool(&state).await;

    let cat_id = get_or_create_category_id(&pool, input.category.clone())
        .await
        .map_err(|e| e.to_string())?;

    let rec = sqlx::query(
        r#"
    INSERT INTO transactions (account_id, date, description, amount, category_id)
    VALUES (?1, ?2, ?3, ?4, ?5);
    "#,
    )
    .bind(input.account_id)
    .bind(input.date)
    .bind(input.description)
    .bind(input.amount)
    .bind(cat_id)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rec.last_insert_rowid())
}

/// Insert both legs of a transfer atomically and link them through `transfer_id`.
async fn add_transfer_impl(pool: &SqlitePool, input: &NewTransfer) -> Result<TransferIds, String> {
    if input.from_account_id == input.to_account_id {
        return Err("Source and destination account must differ".into());
    }
    let amount = input.amount.abs();
    if !(amount > 0.0) {
        return Err("Amount must be non-zero".into());
    }
    let category = input
        .category
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .unwrap_or("Transfer")
        .to_string();
    let cat_id = get_or_create_category_id(pool, Some(category))
        .await
        .map_err(|e| e.to_string())?;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let from_id = sqlx::query(
        "INSERT INTO transactions (account_id, date, description, amount, category_id) \
         VALUES (?1, ?2, ?3, ?4, ?5);",
    )
    .bind(input.from_account_id)
    .bind(&input.date)
    .bind(&input.description)
    .bind(-amount)
    .bind(cat_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .last_insert_rowid();
    let to_id = sqlx::query(
        "INSERT INTO transactions (account_id, date, description, amount, category_id, transfer_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
    )
    .bind(input.to_account_id)
    .bind(&input.date)
    .bind(&input.description)
    .bind(amount)
    .bind(cat_id)
    .bind(from_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .last_insert_rowid();
    sqlx::query("UPDATE transactions SET transfer_id = ?1 WHERE id = ?1")
        .bind(from_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(TransferIds { from_id, to_id })
}

#[tauri::command]
async fn add_transfer(state: State<'_, AppState>, input: NewTransfer) -> Result<TransferIds, String> {
    let pool = current_pool(&state).await;
    add_transfer_impl(&pool, &input).await
}

#[tauri::command]
async fn update_transaction(
    state: State<'_, AppState>,
    input: UpdateTransaction,
) -> Result<bool, String> {
    let pool = current_pool(&state).await;

    // remembered for the linked transfer leg (the values below are moved into the query)
    let sync_date = input.date.clone();
    let sync_desc = input.description.clone();
    let sync_amount = input.amount;
    let mut sync_category: Option<Option<i64>> = None;

    let mut sql = String::from("UPDATE transactions SET ");
    let mut first = true;
    let mut args = SqliteArguments::default();

    fn push_set(sql: &mut String, first: &mut bool, col: &str) {
        if !*first {
            sql.push_str(", ");
        }
        *first = false;
        sql.push_str(col);
        sql.push_str(" = ?");
    }

    if let Some(v) = input.account_id {
        push_set(&mut sql, &mut first, "account_id");
        args.add(v);
    }
    if let Some(v) = input.date {
        push_set(&mut sql, &mut first, "date");
        args.add(v);
    }
    if let Some(v) = input.description {
        push_set(&mut sql, &mut first, "description");
        args.add(v);
    }
    if let Some(v) = input.amount {
        push_set(&mut sql, &mut first, "amount");
        args.add(v);
    }

    if input.category.is_some() {
        let cat_id = get_or_create_category_id(&pool, input.category.clone())
            .await
            .map_err(|e| e.to_string())?;
        sync_category = Some(cat_id);
        match cat_id {
            Some(id) => {
                push_set(&mut sql, &mut first, "category_id");
                args.add(id);
            }
            None => {
                if !first {
                    sql.push_str(", ");
                }
                first = false;
                sql.push_str("category_id = NULL");
            }
        }
    }

    if first {
        return Ok(false);
    }

    sql.push_str(" WHERE id = ?");
    args.add(input.id);

    let res = sqlx::query_with(&sql, args)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    // Keep the other leg of a linked transfer in sync: same date, notes and
    // category, amount with the opposite sign. Only the account is per leg.
    let link: Option<i64> =
        sqlx::query_scalar::<_, Option<i64>>("SELECT transfer_id FROM transactions WHERE id = ?1")
            .bind(input.id)
            .fetch_optional(&pool)
            .await
            .map_err(|e| e.to_string())?
            .flatten();
    if let Some(tid) = link {
        if let Some(v) = sync_date {
            sqlx::query("UPDATE transactions SET date = ?1 WHERE transfer_id = ?2 AND id <> ?3")
                .bind(v)
                .bind(tid)
                .bind(input.id)
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;
        }
        if let Some(v) = sync_desc {
            sqlx::query("UPDATE transactions SET description = ?1 WHERE transfer_id = ?2 AND id <> ?3")
                .bind(v)
                .bind(tid)
                .bind(input.id)
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;
        }
        if let Some(v) = sync_amount {
            sqlx::query("UPDATE transactions SET amount = ?1 WHERE transfer_id = ?2 AND id <> ?3")
                .bind(-v)
                .bind(tid)
                .bind(input.id)
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;
        }
        if let Some(cat) = sync_category {
            sqlx::query("UPDATE transactions SET category_id = ?1 WHERE transfer_id = ?2 AND id <> ?3")
                .bind(cat)
                .bind(tid)
                .bind(input.id)
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(res.rows_affected() > 0)
}

#[tauri::command]
async fn delete_transaction(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
    let pool = current_pool(&state).await;

    delete_transaction_impl(&pool, id).await
}

/// Delete a transaction; a linked transfer loses both legs.
async fn delete_transaction_impl(pool: &SqlitePool, id: i64) -> Result<bool, String> {
    let link: Option<i64> =
        sqlx::query_scalar::<_, Option<i64>>("SELECT transfer_id FROM transactions WHERE id = ?1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?
            .flatten();
    let res = match link {
        Some(tid) => sqlx::query("DELETE FROM transactions WHERE id = ?1 OR transfer_id = ?2")
            .bind(id)
            .bind(tid)
            .execute(pool)
            .await,
        None => sqlx::query("DELETE FROM transactions WHERE id = ?1")
            .bind(id)
            .execute(pool)
            .await,
    }
    .map_err(|e| e.to_string())?;
    Ok(res.rows_affected() > 0)
}

#[tauri::command]
async fn delete_account(state: tauri::State<'_, AppState>, id: i64) -> Result<bool, String> {
    let pool = current_pool(&state).await;

    // refuse if any transactions reference this account
    let cnt: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions WHERE account_id = ?1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;

    if cnt > 0 {
        return Err(format!(
            "This account has {} transaction(s). Move or delete them first.",
            cnt
        ));
    }

    let res = sqlx::query("DELETE FROM accounts WHERE id = ?1")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(res.rows_affected() > 0)
}

#[tauri::command]
async fn update_account(
    state: tauri::State<'_, AppState>,
    id: i64,
    name: Option<String>,
    color: Option<String>,
) -> Result<bool, String> {
    let pool = current_pool(&state).await;

    let res = sqlx::query(
        r#"
    UPDATE accounts
    SET
      name  = COALESCE(?1, name),
      color = COALESCE(?2, color),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?3;
    "#,
    )
    .bind(name)
    .bind(color)
    .bind(id)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(res.rows_affected() > 0)
}

/* ---------- Categories list (for chooser) ---------- */
#[tauri::command]
async fn list_categories(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
    let pool = current_pool(&state).await;

    sqlx::query_as::<_, Category>("SELECT id, name FROM categories ORDER BY name COLLATE NOCASE")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())
}

/* ---------- Helpers for search/export ---------- */
enum BindArg {
    I(i64),
    S(String),
}

fn build_where(filters: &TxSearch, where_sql: &mut String, args: &mut Vec<BindArg>) {
    where_sql.push_str(" WHERE 1=1 ");
    if let Some(acc) = filters.account_id {
        where_sql.push_str(" AND t.account_id = ? ");
        args.push(BindArg::I(acc));
    }
    if let Some(ref df) = filters.date_from {
        where_sql.push_str(" AND DATE(t.date) >= DATE(?) ");
        args.push(BindArg::S(df.clone()));
    }
    if let Some(ref dt) = filters.date_to {
        where_sql.push_str(" AND DATE(t.date) <= DATE(?) ");
        args.push(BindArg::S(dt.clone()));
    }
    if let Some(ref t) = filters.tx_type {
        match t.as_str() {
            "income" => where_sql.push_str(" AND t.amount > 0 "),
            "expense" => where_sql.push_str(" AND t.amount < 0 "),
            "transfer" => where_sql.push_str(" AND t.transfer_id IS NOT NULL "),
            _ => {}
        }
    }
    if let Some(ref q) = filters.query {
        let like = format!("%{}%", q.to_lowercase());
        where_sql.push_str(
            " AND (LOWER(t.description) LIKE ? \
         OR LOWER(c.name) LIKE ?) ",
        );
        args.push(BindArg::S(like.clone()));
        args.push(BindArg::S(like));
    }
}

fn build_order(filters: &TxSearch) -> String {
    let dir = match filters.sort_dir.as_deref() {
        Some("desc") => "DESC",
        _ => "ASC",
    };
    let primary = match filters.sort_by.as_deref() {
        Some("category") => "c.name",
        Some("description") => "t.description",
        Some("amount") => "t.amount",
        Some("account") => "a.name",
        Some("id") => "t.id",
        _ => "DATE(t.date)", // default
    };
    if primary == "t.id" {
        format!(" ORDER BY t.id {} ", dir)
    } else {
        format!(" ORDER BY {} {}, t.id {} ", primary, dir, dir)
    }
}

/* ---------- Search & Export commands ---------- */
#[tauri::command]
async fn search_transactions(
    state: tauri::State<'_, AppState>,
    filters: TxSearch,
) -> Result<TxSearchResult, String> {
    let mut where_sql = String::new();
    let mut args: Vec<BindArg> = Vec::new();
    build_where(&filters, &mut where_sql, &mut args);
    let order_sql = build_order(&filters);

    // Count first (needed to compute last page offset when offset < 0)
    let mut sql_count = String::from(
        "SELECT COUNT(*) FROM transactions t \
     JOIN accounts a ON a.id = t.account_id \
     LEFT JOIN categories c ON c.id = t.category_id",
    );
    sql_count.push_str(&where_sql);
    let mut q_count = sqlx::query_scalar::<_, i64>(&sql_count);
    for a in &args {
        match a {
            BindArg::I(v) => {
                q_count = q_count.bind(*v);
            }
            BindArg::S(s) => {
                q_count = q_count.bind(s);
            }
        }
    }
    let pool = current_pool(&state).await;

    let total = q_count.fetch_one(&pool).await.map_err(|e| e.to_string())?;

    let limit = filters.limit.unwrap_or(15).max(0);
    let req_offset = filters.offset.unwrap_or(-1);
    let last_offset = if total == 0 || limit == 0 {
        0
    } else {
        ((total - 1) / limit) * limit
    };
    let effective_offset = if req_offset < 0 {
        last_offset
    } else if req_offset >= total {
        last_offset
    } else {
        req_offset
    };

    // Items
    let mut sql_items = String::from(
        "SELECT t.id, t.account_id, a.name AS account_name, a.color AS account_color, \
            t.date, c.name AS category, t.description, t.amount, t.transfer_id \
     FROM transactions t \
     JOIN accounts a ON a.id = t.account_id \
     LEFT JOIN categories c ON c.id = t.category_id",
    );
    sql_items.push_str(&where_sql);
    sql_items.push_str(&order_sql);
    sql_items.push_str(" LIMIT ? OFFSET ? ");

    let mut q_items = sqlx::query_as::<_, TransactionOut>(&sql_items);
    for a in &args {
        match a {
            BindArg::I(v) => {
                q_items = q_items.bind(*v);
            }
            BindArg::S(s) => {
                q_items = q_items.bind(s);
            }
        }
    }
    q_items = q_items.bind(limit).bind(effective_offset);
    let items = q_items.fetch_all(&pool).await.map_err(|e| e.to_string())?;

    /* ---------- Sums (global across all results, not current page) ----------
       Income/expense exclude transfers (linked legs or category "Transfer") and
       initial balances ("Init"). Both are returned separately so the frontend
       can show the change of balance for the filtered set.
    */
    let is_transfer = "(t.transfer_id IS NOT NULL OR LOWER(COALESCE(c.name, '')) = 'transfer')";
    let is_init = "(LOWER(COALESCE(c.name, '')) = 'init')";
    let mut sql_sums = format!(
        "SELECT \
           COALESCE(SUM(CASE WHEN NOT {tr} AND NOT {ini} AND t.amount > 0 THEN t.amount END), 0.0) AS income, \
           COALESCE(SUM(CASE WHEN NOT {tr} AND NOT {ini} AND t.amount < 0 THEN t.amount END), 0.0) AS expense, \
           COALESCE(SUM(CASE WHEN {ini} THEN t.amount END), 0.0) AS init, \
           COALESCE(SUM(CASE WHEN {tr} THEN t.amount END), 0.0) AS transfer \
         FROM transactions t \
         JOIN accounts a ON a.id = t.account_id \
         LEFT JOIN categories c ON c.id = t.category_id",
        tr = is_transfer,
        ini = is_init
    );
    sql_sums.push_str(&where_sql);

    let mut q_sums = sqlx::query_as::<_, (f64, f64, f64, f64)>(&sql_sums);
    for a in &args {
        match a {
            BindArg::I(v) => {
                q_sums = q_sums.bind(*v);
            }
            BindArg::S(s) => {
                q_sums = q_sums.bind(s);
            }
        }
    }
    let (sum_income, sum_expense, sum_init, sum_transfer) =
        q_sums.fetch_one(&pool).await.map_err(|e| e.to_string())?;

    Ok(TxSearchResult {
        items,
        total,
        offset: effective_offset,
        sum_income,
        sum_expense,
        sum_init,
        sum_transfer,
    })
}

#[tauri::command]
async fn export_transactions_xlsx(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    filters: TxSearch,
    columns: Option<Vec<String>>,
    lang: Option<String>,
) -> Result<String, String> {
    use chrono::{Datelike, Local, NaiveDate};
    use crate::i18n::Lang;
    use rust_xlsxwriter::{Color, ExcelDateTime, Format, Workbook};

    let lang = Lang::from_code(lang.as_deref());

    /* ---------- Build WHERE + ORDER like search_transactions ---------- */
    let mut where_sql = String::new();
    let mut args: Vec<BindArg> = Vec::new();
    build_where(&filters, &mut where_sql, &mut args);
    let order_sql = build_order(&filters);

    /* ---------- Fetch all matching rows (no paging) ---------- */
    let mut sql = String::from(
        "SELECT t.id, t.account_id, a.name AS account_name, a.color AS account_color, \
            t.date, c.name AS category, t.description, t.amount, t.transfer_id \
     FROM transactions t \
     JOIN accounts a ON a.id = t.account_id \
     LEFT JOIN categories c ON c.id = t.category_id",
    );
    sql.push_str(&where_sql);
    sql.push_str(&order_sql);

    let mut q = sqlx::query_as::<_, TransactionOut>(&sql);
    for a in &args {
        match a {
            BindArg::I(v) => {
                q = q.bind(*v);
            }
            BindArg::S(s) => {
                q = q.bind(s);
            }
        }
    }
    let pool = current_pool(&state).await;

    let items = q.fetch_all(&pool).await.map_err(|e| e.to_string())?;

    /* ---------- Report metadata (Account / Time span / Generated) ---------- */
    // Account label
    let account_label = if let Some(acc_id) = filters.account_id {
        let name_opt = sqlx::query_scalar::<_, String>("SELECT name FROM accounts WHERE id = ?1")
            .bind(acc_id)
            .fetch_optional(&pool)
            .await
            .map_err(|e| e.to_string())?;
        name_opt.unwrap_or_else(|| format!("Account #{acc_id}"))
    } else {
        lang.all_accounts().to_string()
    };

    // Pretty dd.mm.yyyy for filter strings
    let fmt_dmy = |s: &str| -> String {
        NaiveDate::parse_from_str(s, "%Y-%m-%d")
            .map(|d| format!("{:02}.{:02}.{:04}", d.day(), d.month(), d.year()))
            .unwrap_or_else(|_| s.to_string())
    };

    // Time span label
    let time_span_label = match (filters.date_from.as_deref(), filters.date_to.as_deref()) {
        (Some(df), Some(dt)) => format!("{} – {}", fmt_dmy(df), fmt_dmy(dt)),
        (Some(df), None) => lang.from_date(&fmt_dmy(df)),
        (None, Some(dt)) => lang.until_date(&fmt_dmy(dt)),
        _ => lang.all_time().to_string(),
    };

    let generated_at = Local::now().format("%d.%m.%Y %H:%M").to_string();

    /* ---------- Target file path ---------- */
    let download_dir = app.path().download_dir().map_err(|_| "No downloads directory")?;
    let ts = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let path = std::path::PathBuf::from(download_dir).join(format!("transactions_{}.xlsx", ts));

    /* ---------- Column selection (stable order) ---------- */
    let mut cols = columns.unwrap_or_else(|| {
        vec![
            "date".into(),
            "account".into(),
            "category".into(),
            "description".into(),
            "amount".into(),
        ]
    });
    if cols.is_empty() {
        cols = vec![
            "date".into(),
            "account".into(),
            "category".into(),
            "description".into(),
            "amount".into(),
        ];
    }
    let order = ["date", "account", "category", "description", "amount"];
    cols.sort_by_key(|k| order.iter().position(|x| x == &k.as_str()).unwrap_or(999));

    /* ---------- Workbook + formats ---------- */
    let mut wb = Workbook::new();
    let sheet = wb.add_worksheet();

    let title_fmt = Format::new().set_bold().set_font_size(14);
    let label_fmt = Format::new().set_bold();
    let header_fmt = Format::new().set_bold();

    // Real Excel dates with fixed display format
    let date_fmt = Format::new().set_num_format("dd.mm.yyyy");

    // Calm money colors + correct numeric pattern (Excel localizes separators in UI)
    let money_fmt_pos = Format::new()
        .set_num_format("#,##0.00 \"€\"")
        .set_font_color(Color::RGB(0x1B5E20));
    let money_fmt_neg = Format::new()
        .set_num_format("#,##0.00 \"€\"")
        .set_font_color(Color::RGB(0xB71C1C));
    let money_fmt_zero = Format::new()
        .set_num_format("#,##0.00 \"€\"")
        .set_font_color(Color::RGB(0x424242));
    let pick_money_fmt = |v: f64| {
        if v > 0.0 {
            &money_fmt_pos
        } else if v < 0.0 {
            &money_fmt_neg
        } else {
            &money_fmt_zero
        }
    };

    /* ---------- Info block at top ---------- */
    let mut current_row: u32 = 0;

    sheet
        .write_string_with_format(current_row, 0, lang.x_transactions_export(), &title_fmt)
        .map_err(|e| e.to_string())?;
    current_row += 1;

    sheet
        .write_string_with_format(current_row, 0, lang.x_account(), &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_string(current_row, 1, &account_label)
        .map_err(|e| e.to_string())?;
    current_row += 1;

    sheet
        .write_string_with_format(current_row, 0, lang.x_time_span(), &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_string(current_row, 1, &time_span_label)
        .map_err(|e| e.to_string())?;
    current_row += 1;

    sheet
        .write_string_with_format(current_row, 0, lang.x_generated(), &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_string(current_row, 1, &generated_at)
        .map_err(|e| e.to_string())?;
    current_row += 2; // blank line

    /* ---------- Table header ---------- */
    let table_start_row = current_row;
    for (i, key) in cols.iter().enumerate() {
        let label = match key.as_str() {
            "date" => lang.x_date(),
            "account" => lang.x_account(),
            "category" => lang.x_category(),
            "description" => lang.x_notes(),
            "amount" => lang.x_value(),
            _ => key,
        };
        sheet
            .write_string_with_format(table_start_row, i as u16, label, &header_fmt)
            .map_err(|e| e.to_string())?;
    }

    /* ---------- Autosize helpers ---------- */
    // Estimate display width for formatted currency like "1,234,567.89 €"
    fn display_len_amount(v: f64) -> usize {
        let abs = v.abs();
        let whole = abs.trunc() as i128;
        let digits = whole.to_string().len();
        let groups = if digits > 3 { (digits - 1) / 3 } else { 0 };
        let sign = if v < 0.0 { 1 } else { 0 };
        // digits + thousand separators + decimal ".00" + space + € + sign
        digits + groups + 3 + 2 + sign
    }

    let header_labels: Vec<&str> = cols
        .iter()
        .map(|k| match k.as_str() {
            "date" => lang.x_date(),
            "account" => lang.x_account(),
            "category" => lang.x_category(),
            "description" => lang.x_notes(),
            "amount" => lang.x_value(),
            _ => k,
        })
        .collect();
    let mut col_widths: Vec<usize> = header_labels.iter().map(|s| s.chars().count()).collect();

    /* ---------- Rows + totals ---------- */
    let mut sum_income: f64 = 0.0;
    let mut sum_expense: f64 = 0.0;
    let mut sum_init: f64 = 0.0;

    for (r, item) in items.iter().enumerate() {
        let row = table_start_row + 1 + r as u32;

        for (c, key) in cols.iter().enumerate() {
            match key.as_str() {
                "date" => {
                    if let Ok(nd) = NaiveDate::parse_from_str(&item.date, "%Y-%m-%d") {
                        // rust_xlsxwriter 0.69 expects (u16, u8, u8)
                        let y: u16 = u16::try_from(nd.year())
                            .map_err(|_| "Year out of range for ExcelDateTime")?;
                        let m: u8 = u8::try_from(nd.month())
                            .map_err(|_| "Month out of range for ExcelDateTime")?;
                        let d: u8 = u8::try_from(nd.day())
                            .map_err(|_| "Day out of range for ExcelDateTime")?;
                        let dt = ExcelDateTime::from_ymd(y, m, d).map_err(|e| e.to_string())?;
                        sheet
                            .write_datetime_with_format(row, c as u16, &dt, &date_fmt)
                            .map_err(|e| e.to_string())?;
                    } else {
                        sheet
                            .write_string(row, c as u16, &item.date)
                            .map_err(|e| e.to_string())?;
                    }
                    col_widths[c] = col_widths[c].max(10); // dd.mm.yyyy
                }
                "account" => {
                    sheet
                        .write_string(row, c as u16, &item.account_name)
                        .map_err(|e| e.to_string())?;
                    col_widths[c] = col_widths[c].max(item.account_name.chars().count());
                }
                "category" => {
                    let s = item.category.as_deref().unwrap_or("");
                    sheet
                        .write_string(row, c as u16, s)
                        .map_err(|e| e.to_string())?;
                    col_widths[c] = col_widths[c].max(s.chars().count());
                }
                "description" => {
                    let s = item.description.as_deref().unwrap_or("");
                    sheet
                        .write_string(row, c as u16, s)
                        .map_err(|e| e.to_string())?;
                    col_widths[c] = col_widths[c].max(s.chars().count());
                }
                "amount" => {
                    let fmt = pick_money_fmt(item.amount);
                    sheet
                        .write_number_with_format(row, c as u16, item.amount, fmt)
                        .map_err(|e| e.to_string())?;
                    col_widths[c] = col_widths[c].max(display_len_amount(item.amount));
                }
                _ => {
                    sheet
                        .write_string(row, c as u16, "")
                        .map_err(|e| e.to_string())?;
                }
            }
        }

        let lower_cat = item
            .category
            .as_deref()
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        let is_transfer = lower_cat == "transfer" || item.transfer_id.is_some();
        let is_init = lower_cat == "init";

        if is_init {
            sum_init += item.amount; // <— collect initial balance separately
        }
        if !is_transfer && !is_init {
            if item.amount > 0.0 {
                sum_income += item.amount;
            }
            if item.amount < 0.0 {
                sum_expense += item.amount;
            }
        }
    }

    /* ---------- Summary ---------- */
    let summary_row_start = table_start_row + 1 + items.len() as u32 + 1;
    let value_col: u16 = (cols.len().saturating_sub(1)) as u16; // last visible column
    let label_col: u16 = 0;

    sheet
        .write_string_with_format(summary_row_start, label_col, lang.x_total_income(), &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_number_with_format(
            summary_row_start,
            value_col,
            sum_income,
            pick_money_fmt(sum_income),
        )
        .map_err(|e| e.to_string())?;
    col_widths[value_col as usize] =
        col_widths[value_col as usize].max(display_len_amount(sum_income));

    sheet
        .write_string_with_format(
            summary_row_start + 1,
            label_col,
            lang.x_total_expenses(),
            &label_fmt,
        )
        .map_err(|e| e.to_string())?;
    sheet
        .write_number_with_format(
            summary_row_start + 1,
            value_col,
            sum_expense,
            pick_money_fmt(sum_expense),
        )
        .map_err(|e| e.to_string())?;
    col_widths[value_col as usize] =
        col_widths[value_col as usize].max(display_len_amount(sum_expense));

    let saldo = sum_init + sum_income + sum_expense;
    sheet
        .write_string_with_format(summary_row_start + 2, label_col, lang.x_saldo(), &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_number_with_format(
            summary_row_start + 2,
            value_col,
            saldo,
            pick_money_fmt(saldo),
        )
        .map_err(|e| e.to_string())?;
    col_widths[value_col as usize] = col_widths[value_col as usize].max(display_len_amount(saldo));

    /* ---------- Autosize columns (use Result to avoid warnings) ---------- */
    for (c, w) in col_widths.iter().enumerate() {
        // Add small padding and clamp to a reasonable max
        let width = ((*w as f64) + 2.0).min(60.0);
        sheet
            .set_column_width(c as u16, width)
            .map_err(|e| e.to_string())?;
    }

    /* ---------- Save ---------- */
    wb.save(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn export_transactions_pdf(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    filters: TxSearch,
    columns: Option<Vec<String>>,
    lang: Option<String>,
) -> Result<String, String> {
    use crate::i18n::Lang;

    let lang = Lang::from_code(lang.as_deref());
    let pool = current_pool(&state).await;

    let download_dir = app
        .path()
        .download_dir()
        .map_err(|_| "No downloads directory")?;
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let path = std::path::PathBuf::from(download_dir).join(format!("transactions_{}.pdf", ts));

    build_transactions_pdf(&pool, filters, columns, lang, &path).await?;
    Ok(path.to_string_lossy().to_string())
}

/// Builds the transactions PDF and writes it to `path`. Split out of the
/// command so it can be driven from tests against a real database, without a
/// Tauri `AppHandle`.
async fn build_transactions_pdf(
    pool: &SqlitePool,
    filters: TxSearch,
    columns: Option<Vec<String>>,
    lang: crate::i18n::Lang,
    path: &std::path::Path,
) -> Result<(), String> {
    use crate::pdf::{self, Cell, Col, Header, Report};

    /* ---------- fetch rows (respect current filters + sort) ---------- */
    let mut where_sql = String::new();
    let mut args: Vec<BindArg> = Vec::new();
    build_where(&filters, &mut where_sql, &mut args);
    let order_sql = build_order(&filters);

    let mut sql = String::from(
        "SELECT t.id, t.account_id, a.name AS account_name, a.color AS account_color, \
            t.date, c.name AS category, t.description, t.amount, t.transfer_id \
     FROM transactions t \
     JOIN accounts a ON a.id = t.account_id \
     LEFT JOIN categories c ON c.id = t.category_id",
    );
    sql.push_str(&where_sql);
    sql.push_str(&order_sql);

    let mut q = sqlx::query_as::<_, TransactionOut>(&sql);
    for a in &args {
        match a {
            BindArg::I(v) => q = q.bind(*v),
            BindArg::S(s) => q = q.bind(s),
        }
    }
    let items = q.fetch_all(pool).await.map_err(|e| e.to_string())?;

    /* ---------- meta ---------- */
    let account_label = if let Some(acc_id) = filters.account_id {
        let name: Option<(String,)> = sqlx::query_as("SELECT name FROM accounts WHERE id = ?")
            .bind(acc_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
        name.map(|(n,)| n)
            .unwrap_or_else(|| format!("Account #{}", acc_id))
    } else {
        lang.all_accounts().to_string()
    };

    let timespan_label = match (&filters.date_from, &filters.date_to) {
        (Some(df), Some(dt)) => format!("{} – {}", pdf::iso_to_de(df), pdf::iso_to_de(dt)),
        (Some(df), None) => lang.from_date(&pdf::iso_to_de(df)),
        (None, Some(dt)) => lang.until_date(&pdf::iso_to_de(dt)),
        _ => lang.all_time().to_string(),
    };

    /* ---------- totals (unchanged classification) ---------- */
    let mut sum_income: f64 = 0.0;
    let mut sum_expense: f64 = 0.0;
    let mut sum_init: f64 = 0.0;
    for it in &items {
        let lower = it
            .category
            .as_deref()
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        let is_transfer = lower == "transfer" || it.transfer_id.is_some();
        let is_init = lower == "init";
        if is_init {
            sum_init += it.amount;
        }
        if !is_transfer && !is_init {
            if it.amount > 0.0 {
                sum_income += it.amount;
            }
            if it.amount < 0.0 {
                sum_expense += it.amount;
            }
        }
    }
    let saldo = sum_init + sum_income + sum_expense;

    /* ---------- layout ---------- */
    let subtitle = format!("{} · {}", account_label.to_uppercase(), timespan_label);
    let figure = pdf::amount_eur(saldo);

    let (mut report, mut sheet) = Report::new("Transactions export", lang)?;
    pdf::draw_header(
        &report,
        &mut sheet,
        &Header {
            title: lang.title_transactions(),
            subtitle: &subtitle,
            figure_label: lang.net_amount(),
            figure: &figure,
            note: "",
        },
    );

    // Only spend is broken down by category; income would drown the shares.
    // Transfers and opening balances are not spending, exactly as the Stats
    // page treats them.
    let stats = pdf::stats_from(
        &items,
        lang,
        |it| it.category.clone(),
        |it| {
            let lower = it
                .category
                .as_deref()
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_default();
            let skip = it.transfer_id.is_some() || lower == "transfer" || lower == "init";
            if !skip && it.amount < 0.0 {
                it.amount
            } else {
                0.0
            }
        },
    );
    pdf::draw_sidebar(&report, &sheet.layer, sheet.y + 4.0, &stats);

    let cols_sel: Vec<String> = columns.unwrap_or_else(|| {
        vec![
            "date".into(),
            "account".into(),
            "category".into(),
            "description".into(),
            "amount".into(),
        ]
    });
    let table_cols = report_columns(&cols_sel, lang);
    pdf::draw_table_head(&report, &mut sheet, &table_cols);

    let floor = pdf::MARGIN_BOT + 20.0;
    for it in &items {
        if sheet.y < floor {
            report.new_page(&mut sheet);
            pdf::draw_table_head(&report, &mut sheet, &table_cols);
        }
        let desc = it.description.clone().unwrap_or_default();
        let cells: Vec<Cell> = table_cols
            .iter()
            .map(|c: &Col| match c.key.as_str() {
                "date" => Cell::Plain(pdf::iso_to_de(&it.date)),
                "account" => Cell::Plain(it.account_name.clone()),
                "category" => Cell::Pair(it.category.clone().unwrap_or_default(), String::new()),
                "description" => Cell::Pair(desc.clone(), String::new()),
                "category_note" => {
                    Cell::Pair(it.category.clone().unwrap_or_default(), desc.clone())
                }
                // Signs are mixed here, so the value carries a restrained tint.
                "amount" => Cell::Amount(it.amount, true),
                _ => Cell::Plain(String::new()),
            })
            .collect();
        pdf::draw_row(&report, &mut sheet, &table_cols, &cells);
    }

    if items.is_empty() {
        pdf::text(
            &sheet.layer,
            &report.font,
            lang.no_items(),
            pdf::MARGIN_X,
            sheet.y,
            pdf::FS_ROW,
            pdf::ink_3(),
            0.0,
        );
        sheet.y -= pdf::ROW_H;
    }

    if sheet.y < pdf::MARGIN_BOT + 30.0 {
        report.new_page(&mut sheet);
    }
    pdf::draw_total(
        &report,
        &mut sheet,
        &lang.total_items(items.len()),
        &pdf::amount_eur(saldo),
    );

    // Income / expenses / saldo, as three quiet lines under the total.
    let right = pdf::MARGIN_X + pdf::TABLE_W;
    for (label, value, tint) in [
        (lang.income(), sum_income, true),
        (lang.expenses(), sum_expense, true),
        (lang.saldo(), saldo, false),
    ] {
        pdf::text(
            &sheet.layer,
            &report.font,
            label,
            pdf::MARGIN_X,
            sheet.y,
            pdf::FS_LABEL,
            pdf::ink_3(),
            pdf::TRACK_LABEL,
        );
        let color = if !tint {
            pdf::ink()
        } else if value < 0.0 {
            pdf::neg()
        } else {
            pdf::pos()
        };
        pdf::text_right(
            &sheet.layer,
            &report.font,
            &pdf::amount(value),
            right,
            sheet.y,
            pdf::FS_ROW,
            color,
            0.0,
        );
        sheet.y -= 5.4;
    }

    let generated = lang.generated(&chrono::Local::now().format("%d.%m.%Y %H:%M").to_string());
    report.draw_footers(&generated);
    report.save(path)
}

/// Compute the open settlement window for a person account.
///
/// Amounts on a person account are naturally signed (positive = they owe you).
/// The matchers in the report functions work on "working" amounts where a
/// negative value is an open item and a positive value pays open items off,
/// oldest first. Which side is "open" depends on the current balance: if they
/// owe you, the open items are what they still have to pay; if you owe them,
/// the open items are what you still have to pay.
///
/// Returns:
/// - account_name
/// - current_balance (natural sign)
/// - they_owe: true when the balance is >= 0
/// - carry_at_cut (>=0): payoff that happened before the window and applies to its first items
/// - window_oldest_first: rows after the last time nothing was open, with working amounts
async fn compute_settlement_slice(
    pool: &SqlitePool,
    account_id: i64,
) -> Result<(String, f64, bool, f64, Vec<TransactionOut>), String> {
    // Ensure account exists + type + current balance
    let (acc_name, acc_type, balance): (String, String, f64) = sqlx::query_as(
        r#"
        SELECT a.name, a.type, COALESCE(SUM(t.amount), 0.0) AS balance
        FROM accounts a
        LEFT JOIN transactions t ON t.account_id = a.id
        WHERE a.id = ?1
        GROUP BY a.id
        "#,
    )
    .bind(account_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Account not found".to_string())?;

    if acc_type.to_lowercase() != "person" {
        return Err("This report requires a person account".into());
    }

    // Load all tx for this account (oldest→newest)
    let mut oldest_first = sqlx::query_as::<_, TransactionOut>(
        r#"
        SELECT
          t.id, t.account_id, a.name AS account_name, a.color AS account_color,
          t.date, c.name AS category, t.description, t.amount, t.transfer_id
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.account_id = ?1
        ORDER BY DATE(t.date) ASC, t.id ASC
        "#,
    )
    .bind(account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Working sign: open items negative, payoffs positive.
    let they_owe = balance > -1e-9;
    for it in oldest_first.iter_mut() {
        if they_owe {
            it.amount = -it.amount;
        }
    }

    // Running balance to find the last moment nothing was open
    let mut running = 0.0f64;
    let mut last_non_neg_idx: isize = -1;
    let mut carry_at_cut: f64 = 0.0;
    for (i, it) in oldest_first.iter().enumerate() {
        running += it.amount;
        if running >= 0.0 {
            last_non_neg_idx = i as isize;
            carry_at_cut = running; // could be > 0
        }
    }

    // Slice AFTER that index (these are candidates), keep order oldest → newest
    let start_idx: usize = ((last_non_neg_idx + 1).max(0)) as usize;
    let slice_oldest_first: Vec<TransactionOut> = if start_idx < oldest_first.len() {
        oldest_first[start_idx..].to_vec()
    } else {
        Vec::new()
    };

    Ok((acc_name, balance, they_owe, carry_at_cut, slice_oldest_first))
}

#[tauri::command]
async fn export_settlement_report_xlsx(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    filters: TxSearch,
    columns: Option<Vec<String>>,
    target_value: Option<f64>,
    lang: Option<String>,
) -> Result<String, String> {
    use crate::i18n::Lang;
    let lang = Lang::from_code(lang.as_deref());
    use chrono::{Datelike, Local, NaiveDate};
    use rust_xlsxwriter::{Color, ExcelDateTime, Format, Workbook};
    let pool = current_pool(&state).await;

    let acc_id = filters
        .account_id
        .ok_or("Filter to a person account first")?;
    let (account_label, _current_balance, they_owe, carry_at_cut, items_oldest) =
        compute_settlement_slice(&pool, acc_id).await?;
    let direction_label = lang.direction(&account_label, they_owe);

    // Columns (stable order)
    let mut cols = columns.unwrap_or_else(|| {
        vec![
            "date".into(),
            "account".into(),
            "category".into(),
            "description".into(),
            "amount".into(),
        ]
    });
    if cols.is_empty() {
        cols = vec![
            "date".into(),
            "account".into(),
            "category".into(),
            "description".into(),
            "amount".into(),
        ];
    }
    let order = ["date", "account", "category", "description", "amount"];
    cols.sort_by_key(|k| order.iter().position(|x| x == &k.as_str()).unwrap_or(999));

// Build adjusted rows (oldest-first matching; supports partials)
use std::collections::VecDeque;

struct RowRef<'a> {
    it: &'a TransactionOut,
    adj_amount: f64,
    partial_note: Option<String>,
}

struct Open<'a> {
    it: &'a TransactionOut,
    // positive numbers: amount still outstanding for this expense
    remaining: f64,
    original: f64,
}

let mut open: VecDeque<Open<'_>> = VecDeque::new();

// reimbursements that occurred before the slice (if any)
let mut pre = carry_at_cut.max(0.0);

for it in &items_oldest {
    if it.amount < 0.0 {
        // expense
        let mut rem = (-it.amount).max(0.0);

        // apply pre-slice carry to earliest expenses
        if pre > 0.0 {
            let apply = pre.min(rem);
            rem -= apply;
            pre -= apply;
        }

        if rem > 1e-9 {
            open.push_back(Open {
                it,
                remaining: rem,
                original: (-it.amount).max(0.0),
            });
        }
    } else if it.amount > 0.0 {
        // reimbursement (+) cancels oldest open expense first
        let mut payoff = it.amount;
        while payoff > 1e-9 {
            if let Some(front) = open.front_mut() {
                let apply = payoff.min(front.remaining);
                front.remaining -= apply;
                payoff -= apply;
                if front.remaining <= 1e-9 {
                    open.pop_front(); // fully covered
                }
            } else {
                // no open expenses -> becomes future carry for later rows
                pre += payoff;
                break;
            }
        }
    }
}

// Now turn remaining open items into rows (oldest → newest)
let mut rows: Vec<RowRef<'_>> = Vec::with_capacity(open.len());
let mut remaining_target = target_value.unwrap_or(f64::MAX);

for o in open.iter() {
    if remaining_target <= 1e-9 {
        break; // target met
    }

    let mut adj = o.remaining; // positive
    let mut is_target_partial = false;
    
    if adj > remaining_target {
        adj = remaining_target;
        is_target_partial = true;
    }
    
    remaining_target -= adj;
    
    let adj_amount = adj; // open amount, always positive

    let partial_note = if is_target_partial || (adj + 1e-9) < o.original {
        Some(lang.partial(&crate::pdf::amount(adj), &crate::pdf::amount(o.original)))
    } else {
        None
    };
    rows.push(RowRef {
        it: o.it,
        adj_amount,
        partial_note,
    });
}

    // Period from included rows
    let (period_from, period_to) = if rows.is_empty() {
        (None, None)
    } else {
        (
            Some(rows.first().unwrap().it.date.clone()),
            Some(rows.last().unwrap().it.date.clone()),
        )
    };

    // Pretty dd.mm.yyyy
    let fmt_dmy = |s: &str| -> String {
        NaiveDate::parse_from_str(s, "%Y-%m-%d")
            .map(|d| format!("{:02}.{:02}.{:04}", d.day(), d.month(), d.year()))
            .unwrap_or_else(|_| s.to_string())
    };
    let time_span_label = match (period_from.as_deref(), period_to.as_deref()) {
        (Some(df), Some(dt)) => format!("{} – {}", fmt_dmy(df), fmt_dmy(dt)),
        (Some(df), None) => format!("since {}", fmt_dmy(df)),
        (None, Some(dt)) => format!("until {}", fmt_dmy(dt)),
        _ => "—".to_string(),
    };

    // File path
    let download_dir = app.path().download_dir().map_err(|_| "No downloads directory")?;
    let ts = Local::now().format("%Y%m%d").to_string();
    let safe_name: String = account_label
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let path = std::path::PathBuf::from(download_dir)
        .join(format!("settlement_{}_{}.xlsx", safe_name, ts));

    // Workbook + formats (match normal exporter)
    let mut wb = Workbook::new();
    let sheet = wb.add_worksheet();

    let title_fmt = Format::new().set_bold().set_font_size(14);
    let label_fmt = Format::new().set_bold();
    let header_fmt = Format::new().set_bold();
    let date_fmt = Format::new().set_num_format("dd.mm.yyyy");

    let money_fmt_pos = Format::new()
        .set_num_format("#,##0.00 \"€\"")
        .set_font_color(Color::RGB(0x1B5E20));
    let money_fmt_neg = Format::new()
        .set_num_format("#,##0.00 \"€\"")
        .set_font_color(Color::RGB(0xB71C1C));
    let money_fmt_zero = Format::new()
        .set_num_format("#,##0.00 \"€\"")
        .set_font_color(Color::RGB(0x424242));
    let pick_money_fmt = |v: f64| {
        if v > 0.0 {
            &money_fmt_pos
        } else if v < 0.0 {
            &money_fmt_neg
        } else {
            &money_fmt_zero
        }
    };

    let generated_at = Local::now().format("%d.%m.%Y %H:%M").to_string();
    let mut current_row: u32 = 0;

    sheet
        .write_string_with_format(current_row, 0, lang.x_settlement_report(), &title_fmt)
        .map_err(|e| e.to_string())?;
    current_row += 1;

    sheet
        .write_string_with_format(current_row, 0, lang.x_account(), &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_string(current_row, 1, &account_label)
        .map_err(|e| e.to_string())?;
    current_row += 1;

    sheet
        .write_string_with_format(current_row, 0, lang.x_status(), &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_string(current_row, 1, &direction_label)
        .map_err(|e| e.to_string())?;
    current_row += 1;

    sheet
        .write_string_with_format(current_row, 0, lang.x_period(), &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_string(current_row, 1, &time_span_label)
        .map_err(|e| e.to_string())?;
    current_row += 1;

    sheet
        .write_string_with_format(current_row, 0, lang.x_generated(), &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_string(current_row, 1, &generated_at)
        .map_err(|e| e.to_string())?;
    current_row += 2;

    // Header
    let table_start_row = current_row;
    for (i, key) in cols.iter().enumerate() {
        let label = match key.as_str() {
            "date" => lang.x_date(),
            "account" => lang.x_account(),
            "category" => lang.x_category(),
            "description" => lang.x_notes(),
            "amount" => lang.x_value(),
            _ => key,
        };
        sheet
            .write_string_with_format(table_start_row, i as u16, label, &header_fmt)
            .map_err(|e| e.to_string())?;
    }

    // Autosize helpers
    fn display_len_amount(v: f64) -> usize {
        let abs = v.abs();
        let whole = abs.trunc() as i128;
        let digits = whole.to_string().len();
        let groups = if digits > 3 { (digits - 1) / 3 } else { 0 };
        let sign = if v < 0.0 { 1 } else { 0 };
        digits + groups + 3 + 2 + sign
    }
    let header_labels: Vec<&str> = cols
        .iter()
        .map(|k| match k.as_str() {
            "date" => lang.x_date(),
            "account" => lang.x_account(),
            "category" => lang.x_category(),
            "description" => lang.x_notes(),
            "amount" => lang.x_value(),
            _ => k,
        })
        .collect();
    let mut col_widths: Vec<usize> = header_labels.iter().map(|s| s.chars().count()).collect();

    // Rows + single TOTAL at end
    let mut total_outstanding = 0.0f64; // open amount, >= 0.0

    for (r_idx, row) in rows.iter().enumerate() {
        let rownum = table_start_row + 1 + r_idx as u32;

        for (c, key) in cols.iter().enumerate() {
            match key.as_str() {
                "date" => {
                    if let Ok(nd) = NaiveDate::parse_from_str(&row.it.date, "%Y-%m-%d") {
                        let y: u16 = u16::try_from(nd.year()).map_err(|_| "Year out of range")?;
                        let m: u8 = u8::try_from(nd.month()).map_err(|_| "Month out of range")?;
                        let d: u8 = u8::try_from(nd.day()).map_err(|_| "Day out of range")?;
                        let dt = ExcelDateTime::from_ymd(y, m, d).map_err(|e| e.to_string())?;
                        sheet
                            .write_datetime_with_format(rownum, c as u16, &dt, &date_fmt)
                            .map_err(|e| e.to_string())?;
                    } else {
                        sheet
                            .write_string(rownum, c as u16, &row.it.date)
                            .map_err(|e| e.to_string())?;
                    }
                    col_widths[c] = col_widths[c].max(10);
                }
                "account" => {
                    sheet
                        .write_string(rownum, c as u16, &row.it.account_name)
                        .map_err(|e| e.to_string())?;
                    col_widths[c] = col_widths[c].max(row.it.account_name.chars().count());
                }
                "category" => {
                    let s = row.it.category.as_deref().unwrap_or("");
                    sheet
                        .write_string(rownum, c as u16, s)
                        .map_err(|e| e.to_string())?;
                    col_widths[c] = col_widths[c].max(s.chars().count());
                }
                "description" => {
                    let base = row.it.description.as_deref().unwrap_or("");
                    let s = if let Some(note) = &row.partial_note {
                        if base.is_empty() {
                            note.clone()
                        } else {
                            format!("{base} {note}")
                        }
                    } else {
                        base.to_string()
                    };
                    sheet
                        .write_string(rownum, c as u16, &s)
                        .map_err(|e| e.to_string())?;
                    col_widths[c] = col_widths[c].max(s.chars().count());
                }
                "amount" => {
                    let v = row.adj_amount;
                    let fmt = pick_money_fmt(v);
                    sheet
                        .write_number_with_format(rownum, c as u16, v, fmt)
                        .map_err(|e| e.to_string())?;
                    col_widths[c] = col_widths[c].max(display_len_amount(v));
                }
                _ => {
                    sheet
                        .write_string(rownum, c as u16, "")
                        .map_err(|e| e.to_string())?;
                }
            }
        }

        total_outstanding += row.adj_amount;
    }

    // --- Single TOTAL line ---
    let total_row = table_start_row + 1 + rows.len() as u32 + 1;
    let value_col: u16 = (cols.len().saturating_sub(1)) as u16; // last visible col
    let label_col: u16 = 0;

    sheet
        .write_string_with_format(total_row, label_col, lang.x_open_amount(), &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_number_with_format(
            total_row,
            value_col,
            total_outstanding,
            pick_money_fmt(total_outstanding),
        )
        .map_err(|e| e.to_string())?;
    col_widths[value_col as usize] =
        col_widths[value_col as usize].max(display_len_amount(total_outstanding));

    // Autosize
    for (c, w) in col_widths.iter().enumerate() {
        let width = ((*w as f64) + 2.0).min(60.0);
        sheet
            .set_column_width(c as u16, width)
            .map_err(|e| e.to_string())?;
    }

    wb.save(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn export_settlement_report_pdf(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    filters: TxSearch,
    columns: Option<Vec<String>>,
    target_value: Option<f64>,
    lang: Option<String>,
) -> Result<String, String> {
    use crate::i18n::Lang;
    use crate::pdf::{self, Header, Report};

    let lang = Lang::from_code(lang.as_deref());
    let pool = current_pool(&state).await;

    let acc_id = filters
        .account_id
        .ok_or("Filter to a person account first")?;
    let (account_label, _current_balance, they_owe, carry_at_cut, items_oldest) =
        compute_settlement_slice(&pool, acc_id).await?;

    let cols_sel: Vec<String> = columns.unwrap_or_else(|| {
        vec![
            "date".into(),
            "account".into(),
            "category".into(),
            "description".into(),
            "amount".into(),
        ]
    });

    /* ---------- open items, oldest first (unchanged matching) ---------- */
    use std::collections::VecDeque;

    struct RowRef<'a> {
        it: &'a TransactionOut,
        adj_amount: f64,
        desc: String,
    }
    struct Open<'a> {
        it: &'a TransactionOut,
        remaining: f64,
        original: f64,
    }

    let mut open: VecDeque<Open<'_>> = VecDeque::new();
    let mut pre = carry_at_cut.max(0.0);

    for it in &items_oldest {
        if it.amount < 0.0 {
            let mut rem = (-it.amount).max(0.0);
            if pre > 0.0 {
                let apply = pre.min(rem);
                rem -= apply;
                pre -= apply;
            }
            if rem > 1e-9 {
                open.push_back(Open {
                    it,
                    remaining: rem,
                    original: (-it.amount).max(0.0),
                });
            }
        } else if it.amount > 0.0 {
            let mut payoff = it.amount;
            while payoff > 1e-9 {
                if let Some(front) = open.front_mut() {
                    let apply = payoff.min(front.remaining);
                    front.remaining -= apply;
                    payoff -= apply;
                    if front.remaining <= 1e-9 {
                        open.pop_front();
                    }
                } else {
                    pre += payoff;
                    break;
                }
            }
        }
    }

    let mut rows: Vec<RowRef<'_>> = Vec::with_capacity(open.len());
    let mut remaining_target = target_value.unwrap_or(f64::MAX);

    for o in open.iter() {
        if remaining_target <= 1e-9 {
            break;
        }
        let mut adj = o.remaining;
        let mut is_target_partial = false;
        if adj > remaining_target {
            adj = remaining_target;
            is_target_partial = true;
        }
        remaining_target -= adj;

        let mut desc = o.it.description.as_deref().unwrap_or("").to_string();
        if is_target_partial || (adj + 1e-9) < o.original {
            let note = lang.partial(&pdf::amount(adj), &pdf::amount(o.original));
            desc = if desc.is_empty() {
                note
            } else {
                format!("{desc} {note}")
            };
        }
        rows.push(RowRef {
            it: o.it,
            adj_amount: adj,
            desc,
        });
    }

    let total_outstanding: f64 = rows.iter().map(|r| r.adj_amount).sum();

    /* ---------- output path (unchanged naming) ---------- */
    let download_dir = app
        .path()
        .download_dir()
        .map_err(|_| "No downloads directory")?;
    let ts = chrono::Local::now().format("%Y%m%d").to_string();
    let safe_name: String = account_label
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let path = std::path::PathBuf::from(download_dir)
        .join(format!("settlement_{}_{}.pdf", safe_name, ts));

    /* ---------- layout ---------- */
    let period = match (rows.first(), rows.last()) {
        (Some(f), Some(l)) => format!(
            "{} – {}",
            pdf::iso_to_de(&f.it.date),
            pdf::iso_to_de(&l.it.date)
        ),
        _ => lang.all_time().to_string(),
    };
    let subtitle = format!("{} · {}", account_label.to_uppercase(), period);
    let figure = pdf::amount_eur(total_outstanding);
    let note = lang.direction(&account_label, they_owe);

    let (mut report, mut sheet) = Report::new("Settlement statement", lang)?;
    pdf::draw_header(
        &report,
        &mut sheet,
        &Header {
            title: lang.title_settlement(),
            subtitle: &subtitle,
            figure_label: lang.open_amount(),
            figure: &figure,
            note: &note,
        },
    );

    // The sidebar is anchored beside the table on the first page only.
    let stats = pdf::stats_from(
        &rows,
        lang,
        |r| r.it.category.clone(),
        |r| r.adj_amount,
    );
    pdf::draw_sidebar(&report, &sheet.layer, sheet.y + 4.0, &stats);

    let table_cols = report_columns(&cols_sel, lang);
    pdf::draw_table_head(&report, &mut sheet, &table_cols);

    let floor = pdf::MARGIN_BOT + 20.0;
    for row in &rows {
        if sheet.y < floor {
            report.new_page(&mut sheet);
            pdf::draw_table_head(&report, &mut sheet, &table_cols);
        }
        let cells = settlement_cells(&table_cols, row.it, &row.desc, row.adj_amount);
        pdf::draw_row(&report, &mut sheet, &table_cols, &cells);
    }

    if rows.is_empty() {
        pdf::text(
            &sheet.layer,
            &report.font,
            lang.no_items(),
            pdf::MARGIN_X,
            sheet.y,
            pdf::FS_ROW,
            pdf::ink_3(),
            0.0,
        );
        sheet.y -= pdf::ROW_H;
    }

    if sheet.y < pdf::MARGIN_BOT + 16.0 {
        report.new_page(&mut sheet);
    }
    pdf::draw_total(
        &report,
        &mut sheet,
        &lang.total_items(rows.len()),
        &pdf::amount_eur(total_outstanding),
    );

    let generated = lang.generated(&chrono::Local::now().format("%d.%m.%Y %H:%M").to_string());
    report.draw_footers(&generated);
    report.save(&path)?;
    Ok(path.to_string_lossy().to_string())
}

/// Table columns for both reports. When both category and note are selected
/// they share one column, as in the design; otherwise each keeps its own.
fn report_columns(sel: &[String], lang: crate::i18n::Lang) -> Vec<crate::pdf::Col> {
    use crate::pdf::{Col, COL_DATE_W, COL_VALUE_W, TABLE_W};

    let has = |k: &str| sel.iter().any(|c| c == k);
    let (cat, desc) = (has("category"), has("description"));
    let mut cols: Vec<Col> = Vec::new();
    let mut fixed = 0.0;

    if has("date") {
        cols.push(Col {
            key: "date".into(),
            label: lang.col_date().into(),
            w: COL_DATE_W,
            right: false,
        });
        fixed += COL_DATE_W;
    }
    if has("account") {
        cols.push(Col {
            key: "account".into(),
            label: lang.col_account().into(),
            w: 26.0,
            right: false,
        });
        fixed += 26.0;
    }
    if cat || desc {
        let key = if cat && desc {
            "category_note"
        } else if cat {
            "category"
        } else {
            "description"
        };
        let label = match key {
            "category_note" => lang.col_category_note(),
            "category" => lang.col_category(),
            _ => lang.col_note(),
        };
        cols.push(Col {
            key: key.into(),
            label: label.into(),
            w: 0.0, // filled below: this column takes the remaining width
            right: false,
        });
    }
    if has("amount") {
        fixed += COL_VALUE_W;
    }

    let flex = (TABLE_W - fixed).max(20.0);
    for c in cols.iter_mut() {
        if c.w == 0.0 {
            c.w = flex;
        }
    }
    if has("amount") {
        cols.push(Col {
            key: "amount".into(),
            label: lang.col_value().into(),
            w: COL_VALUE_W,
            right: true,
        });
    }

    // With no flexible column (say date + value only) the table would stop
    // short of TABLE_W and the value column would no longer line up with the
    // right-aligned total below it. Hand the slack to the last column.
    let used: f64 = cols.iter().map(|c| c.w).sum();
    if let Some(last) = cols.last_mut() {
        if used < TABLE_W {
            last.w += TABLE_W - used;
        }
    }
    cols
}

fn settlement_cells(
    cols: &[crate::pdf::Col],
    it: &TransactionOut,
    desc: &str,
    amount: f64,
) -> Vec<crate::pdf::Cell> {
    use crate::pdf::{iso_to_de, Cell};
    cols.iter()
        .map(|c| match c.key.as_str() {
            "date" => Cell::Plain(iso_to_de(&it.date)),
            "account" => Cell::Plain(it.account_name.clone()),
            "category" => Cell::Pair(it.category.clone().unwrap_or_default(), String::new()),
            "description" => Cell::Pair(desc.to_string(), String::new()),
            "category_note" => Cell::Pair(
                it.category.clone().unwrap_or_default(),
                desc.to_string(),
            ),
            // Open items are all the same direction, so they stay monochrome.
            "amount" => Cell::Amount(amount, false),
            _ => Cell::Plain(String::new()),
        })
        .collect()
}

#[tauri::command]
async fn add_category(state: State<'_, AppState>, name: String) -> Result<i64, String> {
    let pool = current_pool(&state).await;

    let name = name.trim();
    if name.is_empty() {
        return Err("Category name cannot be empty".into());
    }
    // Insert (ignore duplicates), then fetch id case-insensitively
    sqlx::query("INSERT OR IGNORE INTO categories(name) VALUES (?)")
        .bind(name)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let rec =
        sqlx::query_scalar::<_, i64>("SELECT id FROM categories WHERE name = ? COLLATE NOCASE")
            .bind(name)
            .fetch_one(&pool)
            .await
            .map_err(|e| e.to_string())?;

    Ok(rec)
}

#[tauri::command]
async fn update_category(
    state: State<'_, AppState>,
    id: i64,
    name: String,
) -> Result<bool, String> {
    let pool = current_pool(&state).await;

    let name = name.trim();
    if name.is_empty() {
        return Err("Category name cannot be empty".into());
    }
    let res = sqlx::query("UPDATE categories SET name = ? WHERE id = ?")
        .bind(name)
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(res.rows_affected() > 0)
}

#[tauri::command]
async fn delete_category(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
    let pool = current_pool(&state).await;

    // Only allow delete when not referenced by transactions
    let cnt: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions WHERE category_id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    if cnt > 0 {
        return Err("Category is in use by one or more transactions.".into());
    }
    let res = sqlx::query("DELETE FROM categories WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(res.rows_affected() > 0)
}

// Add near your other output structs
#[derive(Debug, Serialize, sqlx::FromRow)]
struct TxMini {
    account_id: i64,
    date: String, // YYYY-MM-DD
    amount: f64,
}

#[tauri::command]
async fn list_transactions_all(state: tauri::State<'_, AppState>) -> Result<Vec<TxMini>, String> {
    let pool = current_pool(&state).await;
    sqlx::query_as::<_, TxMini>(
        r#"
    SELECT t.account_id, t.date, t.amount
    FROM transactions t
    ORDER BY DATE(t.date) ASC, t.id ASC
    "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())
}

//---------------------------------------

// add:
use std::sync::Arc;
use tokio::sync::RwLock;

// replace your current AppState with:
#[derive(Clone)]
struct AppState {
    pool: Arc<RwLock<SqlitePool>>,
}

// helper: clone the current pool inside any command
async fn current_pool(state: &State<'_, AppState>) -> SqlitePool {
    state.pool.read().await.clone()
}

async fn build_encrypted_pool(db_path: &str, passphrase: &str) -> Result<SqlitePool, sqlx::Error> {
    let pass_owned = passphrase.to_owned(); // must be owned
    let opts = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(false)
        .pragma("key", pass_owned) // FIRST thing that runs
        .pragma("cipher_compatibility", "4"); // DB Browser defaults

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
}

#[tauri::command]
async fn create_database(
    state: State<'_, AppState>,
    db_path: String,
    passphrase: String,
) -> Result<(), String> {
    // Create + key
    let pass_owned = passphrase.clone();
    let opts = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .pragma("key", pass_owned)
        .pragma("cipher_compatibility", "4");

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
        .map_err(|e| map_notadb(&e.to_string(), &db_path))?;

    // Set runtime PRAGMAs after unlock
    let _ = sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await;
    let _ = sqlx::query("PRAGMA journal_mode = WAL;")
        .execute(&pool)
        .await;

    // Create schema
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|e| e.to_string())?;
    *state.pool.write().await = pool;
    Ok(())
}

fn looks_like_plain_sqlite(path: &str) -> bool {
    if let Ok(mut f) = File::open(path) {
        let mut hdr = [0u8; 16];
        if f.read_exact(&mut hdr).is_ok() {
            return &hdr == b"SQLite format 3\0";
        }
    }
    false
}

fn map_notadb(err_text: &str, db_path: &str) -> String {
    let notadb = err_text.contains("file is not a database")
        || err_text.contains("file is encrypted")
        || err_text.contains("not a database"); // different wordings

    if notadb {
        if looks_like_plain_sqlite(db_path) {
            "This file looks like a regular (unencrypted) SQLite database — not an SQLCipher-encrypted DB."
                .into()
        } else {
            "Incorrect password for this encrypted database.".into()
        }
    } else {
        format!("Open failed: {err_text}")
    }
}

#[derive(Debug, Serialize)]
struct OpenDatabaseResult {
    /// True when the file was upgraded to a newer schema during this open.
    migrated: bool,
    /// Copy of the file taken right before the upgrade, if one was made.
    backup_path: Option<String>,
}

/// `<dir>/<stem>.backup-before-0002.<ext>`, with a timestamp suffix if that name is taken.
fn backup_file_path(db_path: &str, target_version: i64) -> std::path::PathBuf {
    let p = Path::new(db_path);
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "database".into());
    let ext = p
        .extension()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "db".into());
    let dir = p.parent().map(|d| d.to_path_buf()).unwrap_or_default();
    let base = dir.join(format!("{stem}.backup-before-{target_version:04}.{ext}"));
    if !base.exists() {
        return base;
    }
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    dir.join(format!("{stem}.backup-before-{target_version:04}-{ts}.{ext}"))
}

#[tauri::command]
async fn open_database(
    state: State<'_, AppState>,
    db_path: String,
    passphrase: String,
) -> Result<OpenDatabaseResult, String> {
    if !Path::new(&db_path).exists() {
        return Err("The selected file does not exist.".into());
    }

    // Connect with key first
    let pool = match build_encrypted_pool(&db_path, &passphrase).await {
        Ok(p) => p,
        Err(e) => return Err(map_notadb(&e.to_string(), &db_path)),
    };

    // Force touching the real file (this fails immediately on wrong key)
    if let Err(e) = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sqlite_master;")
        .fetch_one(&pool)
        .await
    {
        return Err(map_notadb(&e.to_string(), &db_path));
    }

    // Now safe to set other PRAGMAs
    let _ = sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await;
    let _ = sqlx::query("PRAGMA journal_mode = WAL;")
        .execute(&pool)
        .await;

    // Back up the file before applying a schema upgrade, then migrate and swap in.
    let result = upgrade_if_needed(&pool, &db_path).await?;
    *state.pool.write().await = pool;
    Ok(result)
}

/// Apply pending migrations. When the file is on an older schema, copy it next to
/// itself first so the user can always go back to the previous version's data.
async fn upgrade_if_needed(pool: &SqlitePool, db_path: &str) -> Result<OpenDatabaseResult, String> {
    let migrator = sqlx::migrate!("./migrations");
    let latest = migrator.iter().map(|m| m.version).max().unwrap_or(0);
    let applied: i64 =
        sqlx::query_scalar::<_, i64>("SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations")
            .fetch_one(pool)
            .await
            .unwrap_or(0);
    let needs_upgrade = applied > 0 && applied < latest;
    let mut backup_path: Option<String> = None;
    if needs_upgrade {
        // Fold the WAL into the main file so a plain copy is complete.
        let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE);")
            .execute(pool)
            .await;
        let bp = backup_file_path(db_path, latest);
        std::fs::copy(db_path, &bp).map_err(|e| {
            format!("Could not create a backup before upgrading the database: {e}")
        })?;
        backup_path = Some(bp.to_string_lossy().to_string());
    }
    if let Err(e) = migrator.run(pool).await {
        return Err(format!("Database upgrade failed: {e}"));
    }
    Ok(OpenDatabaseResult {
        migrated: needs_upgrade,
        backup_path,
    })
}

#[tauri::command]
async fn close_database(state: State<'_, AppState>) -> Result<(), String> {
    // placeholder pool so commands don’t crash before next login
    let opts = SqliteConnectOptions::new()
        .filename(":memory:")
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .map_err(|e| e.to_string())?;
    *state.pool.write().await = pool;
    Ok(())
}

#[tauri::command]
async fn is_database_open(state: State<'_, AppState>) -> Result<bool, String> {
    let pool = state.pool.read().await.clone();
    // If the pool is still the placeholder (no migrations), 'accounts' won't exist.
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='accounts'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(0);
    Ok(count > 0)
}

/* ---------- App setup ---------- */
#[tauri::command]
async fn system_prefers_dark() -> bool {
    #[cfg(target_os = "linux")]
    {
        use ashpd::desktop::settings::{Settings, ColorScheme};

        if let Ok(proxy) = Settings::new().await {
            // typed read → Result<ColorScheme, _>
            if let Ok(scheme) = proxy
                .read::<ColorScheme>("org.freedesktop.appearance", "color-scheme")
                .await
            {
                return matches!(scheme, ColorScheme::PreferDark);
            }
        }
    }
    false
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // --- your DB init (unchanged) ---
            let pool = tauri::async_runtime::block_on(async move {
                let opts = SqliteConnectOptions::new()
                    .filename(":memory:")
                    .journal_mode(SqliteJournalMode::Wal)
                    .foreign_keys(true);
                SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect_with(opts)
                    .await
            })
            .map_err(|e| e.to_string())?;

            // --- toggle decorations on tiling WMs (Linux) ---
            #[cfg(target_os = "linux")]
            {
                use std::env;
                use tauri::Manager; // for get_webview_window / set_decorations

                // heuristic + manual override via ASSETTRACKER_TILING=0/1/true/false
                let is_tiling = {
                    let desktop = env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_lowercase();
                    let session = env::var("DESKTOP_SESSION").unwrap_or_default().to_lowercase();
                    let wm_name = env::var("XDG_SESSION_DESKTOP").unwrap_or_default().to_lowercase();

                    const TILERS: &[&str] = &[
                        "i3","sway","hypr","hyprland","bspwm","awesome",
                        "qtile","xmonad","river","leftwm","dwm","spectrwm","berry"
                    ];
                    let auto = TILERS.iter().any(|t|
                        desktop.contains(t) || session.contains(t) || wm_name.contains(t)
                    );

                    match env::var("ASSETTRACKER_TILING").ok().as_deref() {
                        Some("1") | Some("true") | Some("yes") => true,
                        Some("0") | Some("false") | Some("no")  => false,
                        _ => auto,
                    }
                };

                if let Some(win) = app.get_webview_window("main") {
                    // Keep native bar by default; hide it on tiling WMs
                    let _ = win.set_decorations(!is_tiling);
                }
            }

            // --- your Portal/appearance listener (unchanged) ---
            #[cfg(target_os = "linux")]
            {
                use ashpd::desktop::settings::{Settings, ColorScheme, APPEARANCE_NAMESPACE, COLOR_SCHEME_KEY};
                use futures_util::StreamExt;
                use tauri::Emitter;

                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let Ok(proxy) = Settings::new().await else { return };
                    let Ok(mut stream) = proxy.receive_setting_changed().await else { return };
                    while let Some(change) = stream.next().await {
                        if change.namespace() == APPEARANCE_NAMESPACE && change.key() == COLOR_SCHEME_KEY {
                            if let Ok(scheme) = proxy.read::<ColorScheme>(APPEARANCE_NAMESPACE, COLOR_SCHEME_KEY).await {
                                let dark = matches!(scheme, ColorScheme::PreferDark);
                                let _ = app_handle.emit("theme-updated", dark);
                            }
                        }
                    }
                });
            }

            app.manage(AppState { pool: Arc::new(RwLock::new(pool)) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_database, create_database, close_database,
            add_account, list_accounts, list_transactions,
            add_transaction, update_transaction, delete_transaction,
            delete_account, update_account,
            list_categories, add_category, update_category, delete_category,
            search_transactions, export_transactions_xlsx, export_transactions_pdf,
            export_settlement_report_xlsx, export_settlement_report_pdf, add_transfer,
            list_transactions_all, is_database_open, system_prefers_dark
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() { run(); }

#[cfg(test)]
mod tests {
    use super::*;
    use std::borrow::Cow;

    /* ---------- report column selection ---------- */

    fn sel(keys: &[&str]) -> Vec<String> {
        keys.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn category_and_note_share_one_column_but_stay_separate_alone() {
        let lang = crate::i18n::Lang::En;

        let both = report_columns(&sel(&["date", "category", "description", "amount"]), lang);
        let keys: Vec<&str> = both.iter().map(|c| c.key.as_str()).collect();
        assert_eq!(keys, vec!["date", "category_note", "amount"]);
        assert_eq!(both[1].label, "CATEGORY / NOTE");

        let cat_only = report_columns(&sel(&["date", "category", "amount"]), lang);
        let keys: Vec<&str> = cat_only.iter().map(|c| c.key.as_str()).collect();
        assert_eq!(keys, vec!["date", "category", "amount"]);
        assert_eq!(cat_only[1].label, "CATEGORY");

        let note_only = report_columns(&sel(&["description", "amount"]), lang);
        let keys: Vec<&str> = note_only.iter().map(|c| c.key.as_str()).collect();
        assert_eq!(keys, vec!["description", "amount"]);
        assert_eq!(note_only[0].label, "NOTE");
    }

    #[test]
    fn a_deselected_column_never_appears() {
        let lang = crate::i18n::Lang::En;
        let cols = report_columns(&sel(&["date", "amount"]), lang);
        let keys: Vec<&str> = cols.iter().map(|c| c.key.as_str()).collect();
        assert_eq!(keys, vec!["date", "amount"]);
        assert!(!keys.contains(&"account"));
    }

    #[test]
    fn columns_always_fill_the_table_width_exactly() {
        let lang = crate::i18n::Lang::En;
        for keys in [
            vec!["date", "account", "category", "description", "amount"],
            vec!["date", "category", "description", "amount"],
            vec!["date", "amount"],
            vec!["amount"],
            vec!["date"],
            vec!["account", "category"],
        ] {
            let cols = report_columns(&sel(&keys), lang);
            let total: f64 = cols.iter().map(|c| c.w).sum();
            assert!(
                (total - crate::pdf::TABLE_W).abs() < 1e-6,
                "{keys:?} spans {total} mm, expected {}",
                crate::pdf::TABLE_W
            );
            assert!(cols.iter().all(|c| c.w > 0.0), "{keys:?} has a zero-width column");
        }
    }

    #[test]
    fn only_the_value_column_is_right_aligned() {
        let lang = crate::i18n::Lang::En;
        let cols = report_columns(&sel(&["date", "account", "category", "description", "amount"]), lang);
        for c in &cols {
            assert_eq!(c.right, c.key == "amount", "{} alignment", c.key);
        }
    }

    /* ---------- the transactions PDF, end to end on a real database ---------- */

    fn all_rows() -> TxSearch {
        TxSearch {
            query: None,
            account_id: None,
            date_from: None,
            date_to: None,
            tx_type: Some("all".into()),
            limit: None,
            offset: None,
            sort_by: Some("date".into()),
            sort_dir: Some("asc".into()),
        }
    }

    /// Parses an exported file back with a real PDF reader, so the assertions
    /// below prove the document is well-formed rather than merely non-empty.
    fn page_count(path: &std::path::Path) -> usize {
        let doc = lopdf::Document::load(path).expect("exported file parses as a PDF");
        doc.get_pages().len()
    }

    #[tokio::test]
    async fn transactions_pdf_is_written_for_both_languages() {
        let (pool, _path) = temp_pool().await;
        migrate_up_to(&pool, 2).await;
        let bank = insert_account(&pool, "Bank", "standard").await;
        insert_tx(&pool, bank, "2026-09-01", Some("Netflix"), -12.99, Some("Abo")).await;
        insert_tx(&pool, bank, "2026-09-02", Some("rewe"), -24.10, Some("Lebensmittel")).await;
        insert_tx(&pool, bank, "2026-09-03", Some("Salary"), 3200.0, Some("Gehalt")).await;

        for lang in [crate::i18n::Lang::En, crate::i18n::Lang::De] {
            let out = std::env::temp_dir().join(format!("at_tx_{:?}.pdf", lang));
            build_transactions_pdf(&pool, all_rows(), None, lang, &out)
                .await
                .expect("pdf built");
            let bytes = std::fs::read(&out).expect("pdf readable");
            assert!(bytes.starts_with(b"%PDF-"), "{lang:?} is not a PDF");
            assert!(bytes.len() > 5000, "{lang:?} looks empty");
            assert_eq!(page_count(&out), 1, "{lang:?} page count");
            let _ = std::fs::remove_file(&out);
        }
    }

    #[tokio::test]
    async fn transactions_pdf_honours_the_column_selection_and_filters() {
        let (pool, _path) = temp_pool().await;
        migrate_up_to(&pool, 2).await;
        let bank = insert_account(&pool, "Bank", "standard").await;
        let cash = insert_account(&pool, "Cash", "standard").await;
        insert_tx(&pool, bank, "2026-09-01", Some("a"), -10.0, Some("Food")).await;
        insert_tx(&pool, cash, "2026-09-02", Some("b"), -20.0, Some("Food")).await;

        // a narrow column set still produces a valid document
        let out = std::env::temp_dir().join("at_tx_cols.pdf");
        build_transactions_pdf(
            &pool,
            all_rows(),
            Some(vec!["date".into(), "amount".into()]),
            crate::i18n::Lang::En,
            &out,
        )
        .await
        .expect("pdf built");
        assert!(std::fs::read(&out).unwrap().starts_with(b"%PDF-"));

        // and so does an account filter that matches a single row
        let mut filtered = all_rows();
        filtered.account_id = Some(cash);
        build_transactions_pdf(&pool, filtered, None, crate::i18n::Lang::De, &out)
            .await
            .expect("pdf built");
        assert!(std::fs::read(&out).unwrap().starts_with(b"%PDF-"));
        let _ = std::fs::remove_file(&out);
    }

    #[tokio::test]
    async fn transactions_pdf_handles_an_empty_result() {
        let (pool, _path) = temp_pool().await;
        migrate_up_to(&pool, 2).await;
        let out = std::env::temp_dir().join("at_tx_empty.pdf");
        build_transactions_pdf(&pool, all_rows(), None, crate::i18n::Lang::En, &out)
            .await
            .expect("empty report still builds");
        assert!(std::fs::read(&out).unwrap().starts_with(b"%PDF-"));
        let _ = std::fs::remove_file(&out);
    }

    #[tokio::test]
    async fn transactions_pdf_paginates_a_long_result() {
        let (pool, _path) = temp_pool().await;
        migrate_up_to(&pool, 2).await;
        let bank = insert_account(&pool, "Bank", "standard").await;
        for i in 0..90 {
            insert_tx(
                &pool,
                bank,
                &format!("2026-09-{:02}", (i % 28) + 1),
                Some("note"),
                -(i as f64 + 1.0),
                Some("Food"),
            )
            .await;
        }
        let out = std::env::temp_dir().join("at_tx_long.pdf");
        build_transactions_pdf(&pool, all_rows(), None, crate::i18n::Lang::En, &out)
            .await
            .expect("pdf built");
        assert!(page_count(&out) > 1, "90 rows should span several pages");
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn report_columns_follow_the_language() {
        let de = report_columns(&sel(&["date", "category", "description", "amount"]), crate::i18n::Lang::De);
        let labels: Vec<&str> = de.iter().map(|c| c.label.as_str()).collect();
        assert_eq!(labels, vec!["DATUM", "KATEGORIE / NOTIZ", "BETRAG"]);
    }

    static TEMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    /// Fresh scratch database file; unique across parallel tests.
    async fn temp_pool() -> (SqlitePool, std::path::PathBuf) {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let seq = TEMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "assettracker-test-{}-{seq}-{nanos}.db",
            std::process::id()
        ));
        let opts = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .unwrap();
        (pool, path)
    }

    /// Apply migrations up to and including `version` (so a test can seed legacy data first).
    async fn migrate_up_to(pool: &SqlitePool, version: i64) {
        let mut m = sqlx::migrate!("./migrations");
        let subset: Vec<sqlx::migrate::Migration> =
            m.iter().filter(|x| x.version <= version).cloned().collect();
        m.migrations = Cow::Owned(subset);
        m.run(pool).await.unwrap();
    }

    async fn insert_account(pool: &SqlitePool, name: &str, ty: &str) -> i64 {
        sqlx::query("INSERT INTO accounts (name, type) VALUES (?1, ?2)")
            .bind(name)
            .bind(ty)
            .execute(pool)
            .await
            .unwrap()
            .last_insert_rowid()
    }

    async fn insert_tx(
        pool: &SqlitePool,
        account_id: i64,
        date: &str,
        desc: Option<&str>,
        amount: f64,
        category: Option<&str>,
    ) -> i64 {
        let cat_id = get_or_create_category_id(pool, category.map(|s| s.to_string()))
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO transactions (account_id, date, description, amount, category_id) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(account_id)
        .bind(date)
        .bind(desc)
        .bind(amount)
        .bind(cat_id)
        .execute(pool)
        .await
        .unwrap()
        .last_insert_rowid()
    }

    async fn amount_of(pool: &SqlitePool, id: i64) -> f64 {
        sqlx::query_scalar("SELECT amount FROM transactions WHERE id = ?1")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }
    async fn transfer_id_of(pool: &SqlitePool, id: i64) -> Option<i64> {
        sqlx::query_scalar::<_, Option<i64>>("SELECT transfer_id FROM transactions WHERE id = ?1")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }
    async fn category_of(pool: &SqlitePool, id: i64) -> Option<String> {
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT c.name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.id = ?1",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
    }
    async fn type_of(pool: &SqlitePool, account_id: i64) -> String {
        sqlx::query_scalar("SELECT type FROM accounts WHERE id = ?1")
            .bind(account_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }
    async fn balance_of(pool: &SqlitePool, account_id: i64) -> f64 {
        sqlx::query_scalar("SELECT COALESCE(SUM(amount), 0.0) FROM transactions WHERE account_id = ?1")
            .bind(account_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }
    fn close(x: f64, y: f64) -> bool {
        (x - y).abs() < 1e-9
    }

    #[tokio::test]
    async fn migration_0002_converts_legacy_reimbursable_data() {
        let (pool, path) = temp_pool().await;
        migrate_up_to(&pool, 1).await;

        let bank = insert_account(&pool, "Bank", "standard").await;
        let anna = insert_account(&pool, "Anna", "reimbursable").await;
        let cash = insert_account(&pool, "Cash", "standard").await;

        // Legacy conventions: a reimbursable account holds mirrored entries with the
        // same sign as the paying account; negative balance = they owe you.
        let a = insert_tx(&pool, bank, "2025-01-10", Some("Ticket"), -30.0, Some("Food")).await;
        let b = insert_tx(&pool, anna, "2025-01-10", Some("Ticket"), -30.0, Some("Food")).await;
        let c = insert_tx(&pool, bank, "2025-02-01", Some("Paid back"), 30.0, Some("Reimbursement")).await;
        let d = insert_tx(&pool, anna, "2025-02-01", Some("Paid back"), 30.0, Some("Reimbursement")).await;
        let e = insert_tx(&pool, bank, "2025-03-01", Some("[Bank -> Cash]"), -100.0, Some("Transfer")).await;
        let f = insert_tx(&pool, cash, "2025-03-01", Some("[Bank -> Cash]"), 100.0, Some("Transfer")).await;
        let g = insert_tx(&pool, anna, "2025-03-05", Some("Initial balance"), -20.0, Some("Init")).await;
        let h = insert_tx(&pool, bank, "2025-03-06", Some("Groceries"), -12.5, Some("Groceries")).await;
        // a mirror-less entry on the reimbursable account (must stay a plain entry)
        let i = insert_tx(&pool, anna, "2025-03-07", Some("Lunch"), -8.0, Some("Food")).await;
        assert!(close(balance_of(&pool, anna).await, -28.0));

        migrate_up_to(&pool, 2).await;

        // account type and CHECK constraint
        assert_eq!(type_of(&pool, anna).await, "person");
        assert_eq!(type_of(&pool, bank).await, "standard");
        assert!(sqlx::query("INSERT INTO accounts (name, type) VALUES ('X', 'reimbursable')")
            .execute(&pool)
            .await
            .is_err());
        let ben = insert_account(&pool, "Ben", "person").await;
        assert_eq!(ben, 4, "autoincrement continues after the rebuild");

        // natural sign on the person account: 28 owed to you
        assert!(close(amount_of(&pool, b).await, 30.0));
        assert!(close(amount_of(&pool, d).await, -30.0));
        assert!(close(amount_of(&pool, g).await, 20.0));
        assert!(close(amount_of(&pool, i).await, 8.0));
        assert!(close(balance_of(&pool, anna).await, 28.0));
        // standard accounts untouched
        assert!(close(amount_of(&pool, a).await, -30.0));
        assert!(close(amount_of(&pool, h).await, -12.5));

        // mirrored pairs became linked transfers and keep what the money was for
        assert_eq!(transfer_id_of(&pool, a).await, Some(a));
        assert_eq!(transfer_id_of(&pool, b).await, Some(a));
        assert_eq!(category_of(&pool, a).await.as_deref(), Some("Food"));
        assert_eq!(category_of(&pool, b).await.as_deref(), Some("Food"));
        assert_eq!(transfer_id_of(&pool, c).await, Some(c));
        assert_eq!(transfer_id_of(&pool, d).await, Some(c));
        assert_eq!(category_of(&pool, c).await.as_deref(), Some("Reimbursement"));
        assert_eq!(category_of(&pool, d).await.as_deref(), Some("Reimbursement"));

        // existing transfer legs got linked
        assert_eq!(transfer_id_of(&pool, e).await, Some(e));
        assert_eq!(transfer_id_of(&pool, f).await, Some(e));

        // everything else is untouched
        assert_eq!(transfer_id_of(&pool, g).await, None);
        assert_eq!(category_of(&pool, g).await.as_deref(), Some("Init"));
        assert_eq!(transfer_id_of(&pool, h).await, None);
        assert_eq!(category_of(&pool, h).await.as_deref(), Some("Groceries"));
        assert_eq!(transfer_id_of(&pool, i).await, None);
        assert_eq!(category_of(&pool, i).await.as_deref(), Some("Food"));

        // integrity: no dangling foreign keys, constraints still enforced
        let fk_rows = sqlx::query("PRAGMA foreign_key_check").fetch_all(&pool).await.unwrap();
        assert!(fk_rows.is_empty());
        let ic: String = sqlx::query_scalar("PRAGMA integrity_check").fetch_one(&pool).await.unwrap();
        assert_eq!(ic, "ok");
        assert!(sqlx::query("DELETE FROM accounts WHERE id = ?1")
            .bind(bank)
            .execute(&pool)
            .await
            .is_err(), "ON DELETE RESTRICT still works after the rebuild");

        // running the migrator again is a no-op
        migrate_up_to(&pool, 2).await;
        assert!(close(amount_of(&pool, b).await, 30.0));

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn upgrade_backs_up_the_old_file_first() {
        let (pool, path) = temp_pool().await;
        migrate_up_to(&pool, 1).await;
        let anna = insert_account(&pool, "Anna", "reimbursable").await;
        insert_tx(&pool, anna, "2025-01-10", Some("Ticket"), -30.0, Some("Food")).await;

        // A fresh file created by this version needs no upgrade and no backup.
        let (pool_new, path_new) = temp_pool().await;
        migrate_up_to(&pool_new, 2).await;
        let r = upgrade_if_needed(&pool_new, &path_new.to_string_lossy()).await.unwrap();
        assert!(!r.migrated);
        assert!(r.backup_path.is_none());

        // A 1.x file is copied next to itself, then converted.
        let r = upgrade_if_needed(&pool, &path.to_string_lossy()).await.unwrap();
        assert!(r.migrated);
        let backup = r.backup_path.expect("backup path");
        assert!(backup.ends_with(".backup-before-0002.db"), "{backup}");
        assert!(std::path::Path::new(&backup).exists());
        assert!(close(amount_of(&pool, 1).await, 30.0), "live file converted");

        // The backup still has the old schema and the old sign.
        let opts = SqliteConnectOptions::new().filename(&backup).create_if_missing(false);
        let bpool = SqlitePoolOptions::new().max_connections(1).connect_with(opts).await.unwrap();
        let old_type: String = sqlx::query_scalar("SELECT type FROM accounts WHERE id = 1").fetch_one(&bpool).await.unwrap();
        assert_eq!(old_type, "reimbursable");
        assert!(close(amount_of(&bpool, 1).await, -30.0));
        let old_version: i64 = sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations").fetch_one(&bpool).await.unwrap();
        assert_eq!(old_version, 1);

        // Opening the upgraded file again is a no-op (no second backup).
        let r = upgrade_if_needed(&pool, &path.to_string_lossy()).await.unwrap();
        assert!(!r.migrated);
        assert!(r.backup_path.is_none());

        // A taken backup name gets a timestamp suffix instead of being overwritten.
        let second = backup_file_path(&path.to_string_lossy(), 2);
        assert_ne!(second.to_string_lossy(), backup);
        assert!(second.to_string_lossy().contains(".backup-before-0002-"));

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&path_new);
        let _ = std::fs::remove_file(&backup);
    }

    #[tokio::test]
    async fn transfers_are_linked_and_deleted_together() {
        let (pool, path) = temp_pool().await;
        migrate_up_to(&pool, 2).await;
        let bank = insert_account(&pool, "Bank", "standard").await;
        let anna = insert_account(&pool, "Anna", "person").await;

        let ids = add_transfer_impl(
            &pool,
            &NewTransfer {
                from_account_id: bank,
                to_account_id: anna,
                date: "2025-04-01".into(),
                amount: 30.0,
                description: Some("Ticket".into()),
                category: Some("Food".into()),
            },
        )
        .await
        .unwrap();
        assert!(close(amount_of(&pool, ids.from_id).await, -30.0));
        assert!(close(amount_of(&pool, ids.to_id).await, 30.0));
        assert_eq!(transfer_id_of(&pool, ids.from_id).await, Some(ids.from_id));
        assert_eq!(transfer_id_of(&pool, ids.to_id).await, Some(ids.from_id));
        // the category records what the money was for, on both legs
        assert_eq!(category_of(&pool, ids.from_id).await.as_deref(), Some("Food"));
        assert_eq!(category_of(&pool, ids.to_id).await.as_deref(), Some("Food"));
        assert!(close(balance_of(&pool, anna).await, 30.0), "Anna owes 30");

        // plain moves between accounts default to "Transfer"
        let cash = insert_account(&pool, "Cash", "standard").await;
        let plain = add_transfer_impl(
            &pool,
            &NewTransfer { from_account_id: bank, to_account_id: cash, date: "2025-04-02".into(), amount: 10.0, description: None, category: None },
        )
        .await
        .unwrap();
        assert_eq!(category_of(&pool, plain.from_id).await.as_deref(), Some("Transfer"));
        assert!(delete_transaction_impl(&pool, plain.from_id).await.unwrap());

        assert!(add_transfer_impl(
            &pool,
            &NewTransfer { from_account_id: bank, to_account_id: bank, date: "2025-04-01".into(), amount: 1.0, description: None, category: None }
        )
        .await
        .is_err());

        // deleting either leg removes both
        assert!(delete_transaction_impl(&pool, ids.to_id).await.unwrap());
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions").fetch_one(&pool).await.unwrap();
        assert_eq!(n, 0);

        let _ = std::fs::remove_file(&path);
    }
}
