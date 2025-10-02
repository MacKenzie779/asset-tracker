#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use printpdf::{Color, IndirectFontRef, Line, Mm, PdfLayerReference, Point, Rgb};
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
    r#type: String, // "standard" | "reimbursable"
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
}

#[derive(Debug, Deserialize)]
struct NewTransaction {
    account_id: i64,
    date: String, // YYYY-MM-DD
    description: Option<String>,
    amount: f64,
    category: Option<String>,
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
    tx_type: Option<String>,   // "all" | "income" | "expense"
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
    sum_income: f64,
    sum_expense: f64,
    sum_income_std: f64,
    sum_expense_std: f64,
    sum_income_reimb: f64,
    sum_expense_reimb: f64,
    // NEW
    sum_init: f64,
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
    account_type: String, // "standard" | "reimbursable"
    initial_balance: Option<f64>,
}

#[tauri::command]
async fn add_account(state: State<'_, AppState>, input: NewAccountInput) -> Result<i64, String> {
    let pool = current_pool(&state).await;

    let rec = sqlx::query("INSERT INTO accounts (name, color, type) VALUES (?1, ?2, ?3);")
        .bind(&input.name)
        .bind(&input.color)
        .bind(&input.account_type)
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
      t.amount
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

#[tauri::command]
async fn update_transaction(
    state: State<'_, AppState>,
    input: UpdateTransaction,
) -> Result<bool, String> {
    let pool = current_pool(&state).await;

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

    Ok(res.rows_affected() > 0)
}

#[tauri::command]
async fn delete_transaction(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
    let pool = current_pool(&state).await;

    let res = sqlx::query("DELETE FROM transactions WHERE id = ?1")
        .bind(id)
        .execute(&pool)
        .await
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
            t.date, c.name AS category, t.description, t.amount \
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
       Exclude category = 'Transfer' (case-insensitive) because internal transfers
       don’t change net income/expense.
    */
    let mut sql_sums = String::from(
    "SELECT \
       COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0.0) AS income, \
       COALESCE(SUM(CASE WHEN t.amount < 0 THEN t.amount END), 0.0) AS expense, \
       COALESCE(SUM(CASE WHEN a.type = 'standard'     AND t.amount > 0 THEN t.amount END), 0.0) AS inc_std, \
       COALESCE(SUM(CASE WHEN a.type = 'standard'     AND t.amount < 0 THEN t.amount END), 0.0) AS exp_std, \
       COALESCE(SUM(CASE WHEN a.type = 'reimbursable' AND t.amount > 0 THEN t.amount END), 0.0) AS inc_reimb, \
       COALESCE(SUM(CASE WHEN a.type = 'reimbursable' AND t.amount < 0 THEN t.amount END), 0.0) AS exp_reimb \
     FROM transactions t \
     JOIN accounts a ON a.id = t.account_id \
     LEFT JOIN categories c ON c.id = t.category_id"
  );

    // Start from the same WHERE (filters), then add "not transfer" for sums only
    let mut where_sums = where_sql.clone();
    where_sums.push_str(" AND LOWER(c.name) NOT IN ('transfer', 'init') ");

    sql_sums.push_str(&where_sums);

    let mut q_sums = sqlx::query_as::<_, (f64, f64, f64, f64, f64, f64)>(&sql_sums);
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

    let (sum_income, sum_expense, inc_std, exp_std, inc_reimb, exp_reimb) =
        q_sums.fetch_one(&pool).await.map_err(|e| e.to_string())?;

    // --- Init sum (only "Init", included in saldo but not in income/expense) ---
    let mut sql_init = String::from(
        "SELECT COALESCE(SUM(t.amount), 0.0) \
     FROM transactions t \
     JOIN accounts a ON a.id = t.account_id \
     LEFT JOIN categories c ON c.id = t.category_id",
    );
    let mut where_init = where_sql.clone();
    where_init.push_str(" AND LOWER(c.name) = 'init' ");
    sql_init.push_str(&where_init);

    let mut q_init = sqlx::query_scalar::<_, f64>(&sql_init);
    for a in &args {
        match a {
            BindArg::I(v) => {
                q_init = q_init.bind(*v);
            }
            BindArg::S(s) => {
                q_init = q_init.bind(s);
            }
        }
    }
    let sum_init = q_init.fetch_one(&pool).await.map_err(|e| e.to_string())?;

    Ok(TxSearchResult {
        items,
        total,
        offset: effective_offset,
        sum_income,
        sum_expense,
        sum_income_std: inc_std,
        sum_expense_std: exp_std,
        sum_income_reimb: inc_reimb,
        sum_expense_reimb: exp_reimb,
        sum_init,
    })
}

#[tauri::command]
async fn export_transactions_xlsx(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    filters: TxSearch,
    columns: Option<Vec<String>>,
) -> Result<String, String> {
    use chrono::{Datelike, Local, NaiveDate};
    use rust_xlsxwriter::{Color, ExcelDateTime, Format, Workbook};

    /* ---------- Build WHERE + ORDER like search_transactions ---------- */
    let mut where_sql = String::new();
    let mut args: Vec<BindArg> = Vec::new();
    build_where(&filters, &mut where_sql, &mut args);
    let order_sql = build_order(&filters);

    /* ---------- Fetch all matching rows (no paging) ---------- */
    let mut sql = String::from(
        "SELECT t.id, t.account_id, a.name AS account_name, a.color AS account_color, \
            t.date, c.name AS category, t.description, t.amount \
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
        "All accounts".to_string()
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
        (Some(df), None) => format!("since {}", fmt_dmy(df)),
        (None, Some(dt)) => format!("until {}", fmt_dmy(dt)),
        _ => "All time".to_string(),
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
        .write_string_with_format(current_row, 0, "Transactions export", &title_fmt)
        .map_err(|e| e.to_string())?;
    current_row += 1;

    sheet
        .write_string_with_format(current_row, 0, "Account", &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_string(current_row, 1, &account_label)
        .map_err(|e| e.to_string())?;
    current_row += 1;

    sheet
        .write_string_with_format(current_row, 0, "Time span", &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_string(current_row, 1, &time_span_label)
        .map_err(|e| e.to_string())?;
    current_row += 1;

    sheet
        .write_string_with_format(current_row, 0, "Generated", &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_string(current_row, 1, &generated_at)
        .map_err(|e| e.to_string())?;
    current_row += 2; // blank line

    /* ---------- Table header ---------- */
    let table_start_row = current_row;
    for (i, key) in cols.iter().enumerate() {
        let label = match key.as_str() {
            "date" => "Date",
            "account" => "Account",
            "category" => "Category",
            "description" => "Notes",
            "amount" => "Value",
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
            "date" => "Date",
            "account" => "Account",
            "category" => "Category",
            "description" => "Notes",
            "amount" => "Value",
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
        let is_transfer = lower_cat == "transfer";
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
        .write_string_with_format(summary_row_start, label_col, "Total income", &label_fmt)
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
            "Total expenses",
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
        .write_string_with_format(summary_row_start + 2, label_col, "Saldo", &label_fmt)
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
) -> Result<String, String> {
    use printpdf::{BuiltinFont, IndirectFontRef, Mm, PdfDocument};
    use std::fs::File;
    use std::io::{BufWriter, Cursor};

    /* ---------- fetch rows (respect current filters + sort) ---------- */
    let mut where_sql = String::new();
    let mut args: Vec<BindArg> = Vec::new();
    build_where(&filters, &mut where_sql, &mut args);
    let order_sql = build_order(&filters);

    let mut sql = String::from(
        "SELECT t.id, t.account_id, a.name AS account_name, a.color AS account_color, \
            t.date, c.name AS category, t.description, t.amount \
     FROM transactions t \
     JOIN accounts a ON a.id = t.account_id \
     LEFT JOIN categories c ON c.id = t.category_id",
    );
    sql.push_str(&where_sql);
    sql.push_str(&order_sql);
    let pool = current_pool(&state).await;

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
    let items = q.fetch_all(&pool).await.map_err(|e| e.to_string())?;

    /* ---------- metadata strings ---------- */
    let account_label = if let Some(acc_id) = filters.account_id {
        let name: Option<(String,)> = sqlx::query_as("SELECT name FROM accounts WHERE id = ?")
            .bind(acc_id)
            .fetch_optional(&pool)
            .await
            .map_err(|e| e.to_string())?;
        name.map(|(n,)| n)
            .unwrap_or_else(|| format!("Account #{}", acc_id))
    } else {
        "All accounts".to_string()
    };

    let timespan_label = match (&filters.date_from, &filters.date_to) {
        (Some(df), Some(dt)) => format!("{} – {}", iso_to_de(df), iso_to_de(dt)),
        (Some(df), None) => format!("from {}", iso_to_de(df)),
        (None, Some(dt)) => format!("until {}", iso_to_de(dt)),
        _ => "All time".to_string(),
    };

    let generated_label = chrono::Local::now().format("%d.%m.%Y %H:%M").to_string();

    /* ---------- output path ---------- */
    let download_dir = app.path().download_dir().map_err(|_| "No downloads directory")?;
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let path = std::path::PathBuf::from(download_dir).join(format!("transactions_{}.pdf", ts));

    /* ---------- PDF canvas ---------- */
    let page_w = Mm(210.0);
    let page_h = Mm(297.0);
    let m_l = Mm(14.0);
    let m_r = Mm(14.0);
    let m_t = Mm(16.0);
    let m_b = Mm(18.0);
    let content_w = page_w.0 - m_l.0 - m_r.0;

    let (doc, page_id, layer_id) =
        PdfDocument::new("Transactions Export", page_w, page_h, "Layer 1");

    /* ---------- fonts (embed DejaVu if present) ---------- */
    fn load_font(
        doc: &printpdf::PdfDocumentReference,
        file: &str,
        fallback: BuiltinFont,
    ) -> Result<IndirectFontRef, String> {
        let path = format!("{}/assets/{}", env!("CARGO_MANIFEST_DIR"), file);
        match std::fs::read(&path) {
            Ok(bytes) => doc
                .add_external_font(Cursor::new(bytes))
                .map_err(|e| e.to_string()),
            Err(_) => doc.add_builtin_font(fallback).map_err(|e| e.to_string()),
        }
    }
    let font_normal = load_font(&doc, "DejaVuSans.ttf", BuiltinFont::Helvetica)?;
    let font_bold = load_font(&doc, "DejaVuSans-Bold.ttf", BuiltinFont::HelveticaBold)?;

    /* ---------- sizes ---------- */
    let fs_title = 13.0;
    let fs_meta = 9.5;
    let fs_head = 10.2;
    let fs_cell = 9.7;
    let header_h = 9.0;
    let row_h = 7.2;
    let pad = 1.8; // cell inner padding (mm)

    /* ---------- columns ---------- */
    let cols: Vec<String> = columns.unwrap_or_else(|| {
        vec![
            "date".into(),
            "account".into(),
            "category".into(),
            "description".into(),
            "amount".into(),
        ]
    });

    fn base_width_for(col: &str) -> f64 {
        match col {
            "date" => 24.0,
            "account" => 36.0,
            "category" => 36.0,
            "amount" => 28.0,
            _ => 24.0,
        }
    }
    // compute widths (description expands)
    let mut sum_fixed = 0.0;
    let mut has_desc = false;
    for c in &cols {
        if c == "description" {
            has_desc = true;
            continue;
        }
        sum_fixed += base_width_for(c);
    }
    let mut col_w_mm: Vec<f64> = Vec::with_capacity(cols.len());
    for c in &cols {
        if c == "description" && has_desc {
            let w = (content_w - sum_fixed).max(24.0);
            col_w_mm.push(w);
        } else {
            col_w_mm.push(base_width_for(c));
        }
    }

    /* ---------- drawing state ---------- */
    let mut page = page_id;
    let mut layer = layer_id;
    let mut layer_ref = doc.get_page(page).get_layer(layer);
    let mut y = page_h.0 - m_t.0;

    /* ---------- top meta block ---------- */
    draw_text(
        &layer_ref,
        &font_bold,
        "Transactions (filtered export)",
        m_l.0,
        y,
        fs_title,
        black(),
    );
    y -= 4.0 + row_h;
    draw_text(
        &layer_ref,
        &font_normal,
        &format!("Account: {}", account_label),
        m_l.0,
        y,
        fs_meta,
        black(),
    );
    y -= row_h;
    draw_text(
        &layer_ref,
        &font_normal,
        &format!("Time span: {}", timespan_label),
        m_l.0,
        y,
        fs_meta,
        black(),
    );
    y -= row_h;
    draw_text(
        &layer_ref,
        &font_normal,
        &format!("Generated: {}", generated_label),
        m_l.0,
        y,
        fs_meta,
        black(),
    );
    y -= row_h + 2.0;

    /* ---------- header band ---------- */
    draw_table_header(
        &layer_ref, &font_bold, m_l.0, y, content_w, header_h, &cols, &col_w_mm, fs_head, pad,
    );
    y -= header_h;

    /* ---------- rows ---------- */
    let mut sum_income: f64 = 0.0;
    let mut sum_expense: f64 = 0.0;
    let mut sum_init: f64 = 0.0;

    for (row_idx, it) in items.iter().enumerate() {
        // page break (keep some space for summary)
        if y < m_b.0 + (row_h * 4.0) {
            let (np, nl) = doc.add_page(page_w, page_h, "Layer");
            page = np;
            layer = nl;
            layer_ref = doc.get_page(page).get_layer(layer);
            y = page_h.0 - m_t.0;
            draw_table_header(
                &layer_ref, &font_bold, m_l.0, y, content_w, header_h, &cols, &col_w_mm, fs_head,
                pad,
            );
            y -= header_h;
        }

        // zebra bg
        if row_idx % 2 == 1 {
            draw_rect(
                &layer_ref,
                m_l.0,
                y,
                content_w,
                row_h,
                Some(row_alt()),
                None,
            );
        }

        // vertical grid (inner + outer)
        {
            let mut gx = m_l.0;
            draw_rect(&layer_ref, gx, y, 0.1, row_h, None, Some((grid(), 0.18))); // left border
            for (_, w) in col_w_mm.iter().enumerate() {
                gx += *w;
                draw_rect(&layer_ref, gx, y, 0.1, row_h, None, Some((grid(), 0.18)));
            }
        }

        // values in order of cols
        let mut x = m_l.0;
        for (i, w) in col_w_mm.iter().enumerate() {
            let key = cols[i].as_str();
            if key == "amount" {
                // SAFEST: left-align inside the cell to guarantee it's inside the box
                let s_full = format!("{} €", format_amount_eu(it.amount));
                let s = clip_by_max_chars(&s_full, *w, fs_cell, pad);
                let color = if it.amount < 0.0 { expense() } else { income() };
                draw_text(&layer_ref, &font_bold, &s, x + pad, y, fs_cell, color);
            } else {
                let content = match key {
                    "date" => iso_to_de(&it.date),
                    "account" => it.account_name.clone(),
                    "category" => it.category.clone().unwrap_or_default(),
                    "description" => it.description.clone().unwrap_or_default(),
                    other => other.to_string(),
                };
                let s = clip_for_width_with_font(&font_normal, &content, *w, fs_cell, pad);
                draw_text(&layer_ref, &font_normal, &s, x + pad, y, fs_cell, black());
            }
            x += *w;
        }

        // horizontal hairline
        draw_rect(
            &layer_ref,
            m_l.0,
            y,
            content_w,
            0.1,
            None,
            Some((grid(), 0.18)),
        );

        let lower = it
            .category
            .as_deref()
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        let is_transfer = lower == "transfer";
        let is_init = lower == "init";

        if is_init {
            sum_init += it.amount; // <— collect initial balance
        }
        if !is_transfer && !is_init {
            if it.amount > 0.0 {
                sum_income += it.amount;
            }
            if it.amount < 0.0 {
                sum_expense += it.amount;
            }
        }

        y -= row_h;
    }

    /* ---------- summary ---------- */
    let saldo = sum_init + sum_income + sum_expense;
    if y < m_b.0 + (row_h * 4.0) {
        let (np, nl) = doc.add_page(page_w, page_h, "Layer");
        page = np;
        layer = nl;
        layer_ref = doc.get_page(page).get_layer(layer);
        y = page_h.0 - m_t.0;
    }

    y -= 2.0;
    draw_rect(
        &layer_ref,
        m_l.0,
        y,
        content_w,
        row_h * 3.0,
        Some(total_bg()),
        Some((grid(), 0.3)),
    );

    // income
    {
        let label = "Total income";
        let value = format!("{} €", format_amount_eu(sum_income));
        draw_text(
            &layer_ref,
            &font_bold,
            label,
            m_l.0 + pad,
            y,
            fs_head,
            black(),
        );
        let rx = text_right_x(m_l.0, content_w, &font_bold, &value, fs_head, pad);
        draw_text(&layer_ref, &font_bold, &value, rx, y, fs_head, income());
        y -= row_h;
    }
    // expenses
    {
        let label = "Total expenses";
        let value = format!("{} €", format_amount_eu(sum_expense));
        draw_text(
            &layer_ref,
            &font_bold,
            label,
            m_l.0 + pad,
            y,
            fs_head,
            black(),
        );
        let rx = text_right_x(m_l.0, content_w, &font_bold, &value, fs_head, pad);
        draw_text(&layer_ref, &font_bold, &value, rx, y, fs_head, expense());
        y -= row_h;
    }
    // saldo
    {
        let label = "Saldo";
        let value = format!("{} €", format_amount_eu(saldo));
        draw_text(
            &layer_ref,
            &font_bold,
            label,
            m_l.0 + pad,
            y,
            fs_head,
            black(),
        );
        let rx = text_right_x(m_l.0, content_w, &font_bold, &value, fs_head, pad);
        let s_col = if saldo < 0.0 { expense() } else { income() };
        draw_text(&layer_ref, &font_bold, &value, rx, y, fs_head, s_col);
    }

    // save
    let file = File::create(&path).map_err(|e| e.to_string())?;
    doc.save(&mut BufWriter::new(file))
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/* ======================================================================
Helpers (colors, drawing, layout, formatting, clipping, alignment)
====================================================================== */

fn black() -> Color {
    Color::Rgb(Rgb::new(0.0, 0.0, 0.0, None))
}
fn grid() -> Color {
    Color::Rgb(Rgb::new(0.84, 0.85, 0.86, None))
} // #D6D6DB
fn header_bg() -> Color {
    Color::Rgb(Rgb::new(0.95, 0.96, 0.98, None))
}
fn row_alt() -> Color {
    Color::Rgb(Rgb::new(0.985, 0.985, 0.985, None))
}
fn income() -> Color {
    Color::Rgb(Rgb::new(0.09, 0.64, 0.29, None))
} // green-600
fn expense() -> Color {
    Color::Rgb(Rgb::new(0.86, 0.15, 0.15, None))
} // red-600
fn total_bg() -> Color {
    Color::Rgb(Rgb::new(0.94, 0.97, 0.94, None))
} // greenish tint

fn draw_rect(
    layer: &PdfLayerReference,
    x: f64,
    y_top: f64,
    w: f64,
    h: f64,
    fill: Option<Color>,
    stroke: Option<(Color, f64)>,
) {
    let pts = vec![
        (Point::new(Mm(x), Mm(y_top)), false),
        (Point::new(Mm(x + w), Mm(y_top)), false),
        (Point::new(Mm(x + w), Mm(y_top - h)), false),
        (Point::new(Mm(x), Mm(y_top - h)), false),
    ];
    let shape = Line {
        points: pts,
        is_closed: true,
        has_fill: fill.is_some(),
        has_stroke: stroke.is_some(),
        is_clipping_path: false,
    };
    if let Some(c) = fill {
        layer.set_fill_color(c);
    }
    if let Some((c, th)) = stroke {
        layer.set_outline_color(c);
        layer.set_outline_thickness(th);
    }
    layer.add_shape(shape);
}

fn draw_text(
    layer: &PdfLayerReference,
    font: &IndirectFontRef,
    s: &str,
    x: f64,
    y_top: f64,
    fs: f64,
    color: Color,
) {
    layer.set_fill_color(color);
    // baseline tweak so text looks centered in the row height we use
    layer.use_text(s, fs, Mm(x), Mm(y_top - 4.0), font);
}

fn draw_table_header(
    layer: &PdfLayerReference,
    font_bold: &IndirectFontRef,
    x0: f64,
    y_top: f64,
    content_w: f64,
    header_h: f64,
    cols: &[String],
    col_w_mm: &[f64],
    fs_head: f64,
    pad: f64,
) {
    draw_rect(
        layer,
        x0,
        y_top,
        content_w,
        header_h,
        Some(header_bg()),
        Some((grid(), 0.3)),
    );
    draw_rect(layer, x0, y_top, 0.1, header_h, None, Some((grid(), 0.3)));
    draw_rect(
        layer,
        x0 + content_w,
        y_top,
        0.1,
        header_h,
        None,
        Some((grid(), 0.3)),
    );

    let mut x = x0;
    for (i, w) in col_w_mm.iter().enumerate() {
        if i > 0 {
            draw_rect(layer, x, y_top, 0.1, header_h, None, Some((grid(), 0.3)));
        }
        let label = match cols[i].as_str() {
            "date" => "Date",
            "account" => "Account",
            "category" => "Category",
            "description" => "Notes",
            "amount" => "Value",
            other => other,
        };
        // To guarantee "inside cell", header labels are left-aligned too
        draw_text(layer, font_bold, label, x + pad, y_top, fs_head, black());
        x += *w;
    }
    draw_rect(layer, x0, y_top, content_w, 0.1, None, Some((grid(), 0.3)));
}

// "YYYY-MM-DD" -> "DD.MM.YYYY"
fn iso_to_de(iso: &str) -> String {
    if iso.len() >= 10 {
        let y = &iso[0..4];
        let m = &iso[5..7];
        let d = &iso[8..10];
        format!("{}.{}.{}", d, m, y)
    } else {
        iso.to_string()
    }
}

// 1.234,56 with sign (no currency symbol)
fn format_amount_eu(v: f64) -> String {
    let sign = if v < 0.0 { "-" } else { "" };
    let n = (v.abs() * 100.0).round() / 100.0;
    let s = format!("{:.2}", n);
    let parts = s.split('.').collect::<Vec<_>>();
    let mut int = parts[0].to_string();
    let frac = parts.get(1).copied().unwrap_or("00");
    let mut out = String::new();
    while int.len() > 3 {
        let rest = int.split_off(int.len() - 3);
        out = format!(".{}{}", rest, out);
    }
    out = format!("{}{}", int, out);
    format!("{}{},{}", sign, out, frac)
}

/* ---- conservative clipping & right-edge placement for summary ---- */

// VERY conservative char-based clip so content never spills out of a column.
// Uses a "worst case" per-char width to decide how many characters can fit.
fn clip_by_max_chars(s: &str, col_mm: f64, fs_pt: f64, padding_mm: f64) -> String {
    // worst-case per-char width (mm) at 9.7 pt, scaled with font size
    let worst_per_char = 0.90 * (fs_pt / 9.7);
    let avail = (col_mm - 2.0 * padding_mm).max(3.0);
    let max_chars = (avail / worst_per_char).floor() as usize;
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let mut out = String::new();
    let mut count = 0usize;
    for ch in s.chars() {
        if count + 1 >= max_chars {
            break;
        }
        out.push(ch);
        count += 1;
    }
    out.push('…');
    out
}

// Cheap right-align helper for summary values (page-wide line).
// Compute start-X so text ends at the cell's right padding,
// using a conservative worst-case per-char width based on font size.
// This guarantees the value stays inside the colored summary box.
fn text_right_x(
    col_left_mm: f64,
    col_w_mm: f64,
    _font: &IndirectFontRef, // kept for API compatibility
    s: &str,
    fs_pt: f64,
    padding_mm: f64,
) -> f64 {
    // worst-case char width at 9.7pt, scaled by fs
    // (intentionally large so we never overflow to the right)
    let per_char_mm = 0.90 * (fs_pt / 4.5);
    let mut w = (s.chars().count() as f64) * per_char_mm;

    // never assume wider than the available inner width
    let max_inner = (col_w_mm - 2.0 * padding_mm).max(0.0);
    if w > max_inner {
        w = max_inner;
    }

    let tx = col_left_mm + col_w_mm - padding_mm - w;
    // and never go left of the left padding
    tx.max(col_left_mm + padding_mm)
}

// --- width estimator tuned for amounts (digits, separators, minus, €) ---
// We can't read real glyph metrics from printpdf, so we approximate the width
// in millimeters based on the font size and character class.
fn est_char_mm(ch: char, fs_pt: f64) -> f64 {
    // base mm per "average digit" at fs=9.7 pt (empirically tuned)
    let base = 0.46 * (fs_pt / 9.7);
    match ch {
        // narrower digits
        '1' => base * 0.78,
        // decimal/grouping separators and space
        '.' | ',' => base * 0.62,
        ' ' => base * 0.55,
        // minus sign
        '-' => base * 0.70,
        // euro tends to be a bit wider
        '€' => base * 1.18,
        // typical wide letters fall back here; we mostly print numbers anyway
        _ => base * 1.00,
    }
}

// Approximate text width in mm for a given string at font size fs_pt
// Signature kept the same to avoid changing the call sites; `font` is unused.
fn text_width_mm(_font: &IndirectFontRef, s: &str, fs_pt: f64) -> f64 {
    s.chars().map(|ch| est_char_mm(ch, fs_pt)).sum()
}

// Clip a string so it fits in a column using the estimator (keeps signature).
fn clip_for_width_with_font(
    font: &IndirectFontRef, // unused (kept for API compatibility)
    s: &str,
    col_mm: f64,
    fs_pt: f64,
    padding_mm: f64,
) -> String {
    let avail = (col_mm - 2.0 * padding_mm).max(3.0);
    if text_width_mm(font, s, fs_pt) <= avail {
        return s.to_string();
    }
    let ell = '…';
    let ell_w = est_char_mm(ell, fs_pt);

    let mut out = String::new();
    let mut acc = 0.0;
    for ch in s.chars() {
        let w = est_char_mm(ch, fs_pt);
        if acc + w + ell_w > avail {
            break;
        }
        out.push(ch);
        acc += w;
    }
    out.push(ell);
    out
}

/// Compute the open reimbursement window for a reimbursable account.
///
/// Returns:
/// - account_name
/// - current_balance (final running sum over all tx)
/// - carry_at_cut (>=0): positive balance at the cut point that must be applied to subsequent expenses
/// - slice_oldest_first: transactions *after* the cut, in the natural order (oldest → newest)
async fn compute_reimbursable_slice(
    pool: &SqlitePool,
    account_id: i64,
) -> Result<(String, f64, f64, Vec<TransactionOut>), String> {
    // Ensure account exists + type + current balance
    let (acc_name, acc_type, _balance): (String, String, f64) = sqlx::query_as(
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

    if acc_type.to_lowercase() != "reimbursable" {
        return Err("This export requires a reimbursable account".into());
    }

    // Load all tx for this account (oldest→newest)
    let oldest_first = sqlx::query_as::<_, TransactionOut>(
        r#"
        SELECT
          t.id, t.account_id, a.name AS account_name, a.color AS account_color,
          t.date, c.name AS category, t.description, t.amount
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

    // Running balance to find the last moment the balance was >= 0
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
    let slice_oldest_first: Vec<TransactionOut> =
        if (last_non_neg_idx as usize) + 1 <= oldest_first.len() {
            oldest_first[(last_non_neg_idx as usize + 1)..].to_vec()
        } else {
            Vec::new()
        };

    Ok((
        acc_name,
        running, /*current_balance*/
        carry_at_cut,
        slice_oldest_first,
    ))
}

#[tauri::command]
async fn export_reimbursable_report_xlsx(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    filters: TxSearch,
    columns: Option<Vec<String>>,
) -> Result<String, String> {
    use chrono::{Datelike, Local, NaiveDate};
    use rust_xlsxwriter::{Color, ExcelDateTime, Format, Workbook};
    let pool = current_pool(&state).await;

    let acc_id = filters
        .account_id
        .ok_or("Filter to a reimbursable account first")?;
    let (account_label, _current_balance, mut carry_at_cut, items_oldest) =
        compute_reimbursable_slice(&pool, acc_id).await?;

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

    // Build adjusted rows (keep order oldest→newest, apply carry & mark partials)
    struct RowRef<'a> {
        it: &'a TransactionOut,
        adj_amount: f64,
        partial_note: Option<String>,
    }
    let mut rows: Vec<RowRef<'_>> = Vec::new();

    for it in &items_oldest {
        if it.amount < 0.0 {
            if carry_at_cut > 0.0 {
                let can_apply = carry_at_cut.min((-it.amount).max(0.0));
                let adj = it.amount + can_apply; // closer to 0 (less negative)
                carry_at_cut -= can_apply;
                if adj.abs() < 1e-9 {
                    continue; // fully covered
                } else {
                    let note = format!(
                        "(partial: {} € of {} €)",
                        format_amount_eu((-adj).max(0.0)),
                        format_amount_eu(-it.amount)
                    );
                    rows.push(RowRef {
                        it,
                        adj_amount: adj,
                        partial_note: Some(note),
                    });
                }
            } else {
                rows.push(RowRef {
                    it,
                    adj_amount: it.amount,
                    partial_note: None,
                });
            }
        } else if it.amount > 0.0 {
            carry_at_cut += it.amount; // reimbursements after the cut reduce later expenses
        }
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
        .join(format!("reimbursable_{}_{}.xlsx", safe_name, ts));

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
        .write_string_with_format(current_row, 0, "Reimbursable report", &title_fmt)
        .map_err(|e| e.to_string())?;
    current_row += 1;

    sheet
        .write_string_with_format(current_row, 0, "Account", &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_string(current_row, 1, &account_label)
        .map_err(|e| e.to_string())?;
    current_row += 1;

    sheet
        .write_string_with_format(current_row, 0, "Period", &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_string(current_row, 1, &time_span_label)
        .map_err(|e| e.to_string())?;
    current_row += 1;

    sheet
        .write_string_with_format(current_row, 0, "Generated", &label_fmt)
        .map_err(|e| e.to_string())?;
    sheet
        .write_string(current_row, 1, &generated_at)
        .map_err(|e| e.to_string())?;
    current_row += 2;

    // Header
    let table_start_row = current_row;
    for (i, key) in cols.iter().enumerate() {
        let label = match key.as_str() {
            "date" => "Date",
            "account" => "Account",
            "category" => "Category",
            "description" => "Notes",
            "amount" => "Value",
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
            "date" => "Date",
            "account" => "Account",
            "category" => "Category",
            "description" => "Notes",
            "amount" => "Value",
            _ => k,
        })
        .collect();
    let mut col_widths: Vec<usize> = header_labels.iter().map(|s| s.chars().count()).collect();

    // Rows + single TOTAL at end
    let mut total_outstanding = 0.0f64; // will be <= 0.0

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
        .write_string_with_format(total_row, label_col, "Total", &label_fmt)
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
async fn export_reimbursable_report_pdf(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    filters: TxSearch,
    columns: Option<Vec<String>>,
) -> Result<String, String> {
    use printpdf::{BuiltinFont, IndirectFontRef, Mm, PdfDocument};
    use std::fs::File;
    use std::io::{BufWriter, Cursor};
    let pool = current_pool(&state).await;

    let acc_id = filters
        .account_id
        .ok_or("Filter to a reimbursable account first")?;
    let (account_label, _current_balance, mut carry_at_cut, items_oldest) =
        compute_reimbursable_slice(&pool, acc_id).await?;

    // Columns
    let cols: Vec<String> = columns.unwrap_or_else(|| {
        vec![
            "date".into(),
            "account".into(),
            "category".into(),
            "description".into(),
            "amount".into(),
        ]
    });

    // Build adjusted rows (same logic as XLSX)
    struct RowRef<'a> {
        it: &'a TransactionOut,
        adj_amount: f64,
        desc: String,
    }
    let mut rows: Vec<RowRef<'_>> = Vec::new();

    for it in &items_oldest {
        if it.amount < 0.0 {
            if carry_at_cut > 0.0 {
                let can_apply = carry_at_cut.min((-it.amount).max(0.0));
                let adj = it.amount + can_apply;
                carry_at_cut -= can_apply;
                if adj.abs() < 1e-9 {
                    continue;
                } else {
                    let base = it.description.as_deref().unwrap_or("").to_string();
                    let note = format!(
                        "(partial: {} € of {} €)",
                        format_amount_eu((-adj).max(0.0)),
                        format_amount_eu(-it.amount)
                    );
                    let desc = if base.is_empty() {
                        note
                    } else {
                        format!("{base} {note}")
                    };
                    rows.push(RowRef {
                        it,
                        adj_amount: adj,
                        desc,
                    });
                }
            } else {
                let desc = it.description.as_deref().unwrap_or("").to_string();
                rows.push(RowRef {
                    it,
                    adj_amount: it.amount,
                    desc,
                });
            }
        } else if it.amount > 0.0 {
            carry_at_cut += it.amount;
        }
    }

    // Period
    let (period_from, period_to) = if rows.is_empty() {
        (None, None)
    } else {
        (
            Some(rows.first().unwrap().it.date.clone()),
            Some(rows.last().unwrap().it.date.clone()),
        )
    };

    // Output path
    let download_dir = app.path().download_dir().map_err(|_| "No downloads directory")?;
    let ts = chrono::Local::now().format("%Y%m%d").to_string();
    let safe_name: String = account_label
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let path = std::path::PathBuf::from(download_dir)
        .join(format!("reimbursable_{}_{}.pdf", safe_name, ts));

    // PDF canvas setup
    let page_w = Mm(210.0);
    let page_h = Mm(297.0);
    let m_l = Mm(14.0);
    let m_r = Mm(14.0);
    let m_t = Mm(16.0);
    let m_b = Mm(18.0);
    let content_w = page_w.0 - m_l.0 - m_r.0;

    let (doc, page_id, layer_id) =
        PdfDocument::new("Reimbursable Report", page_w, page_h, "Layer 1");

    // fonts
    fn load_font(
        doc: &printpdf::PdfDocumentReference,
        file: &str,
        fallback: BuiltinFont,
    ) -> Result<IndirectFontRef, String> {
        let path = format!("{}/assets/{}", env!("CARGO_MANIFEST_DIR"), file);
        match std::fs::read(&path) {
            Ok(bytes) => doc
                .add_external_font(Cursor::new(bytes))
                .map_err(|e| e.to_string()),
            Err(_) => doc.add_builtin_font(fallback).map_err(|e| e.to_string()),
        }
    }
    let font_normal = load_font(&doc, "DejaVuSans.ttf", BuiltinFont::Helvetica)?;
    let font_bold = load_font(&doc, "DejaVuSans-Bold.ttf", BuiltinFont::HelveticaBold)?;

    // sizes
    let fs_title = 13.0;
    let fs_meta = 9.5;
    let fs_head = 10.2;
    let fs_cell = 9.7;
    let header_h = 9.0;
    let row_h = 7.2;
    let pad = 1.8;

    // widths (description expands)
    fn base_width_for(col: &str) -> f64 {
        match col {
            "date" => 24.0,
            "account" => 36.0,
            "category" => 36.0,
            "amount" => 28.0,
            _ => 24.0,
        }
    }
    let mut sum_fixed = 0.0;
    let mut has_desc = false;
    for c in &cols {
        if c == "description" {
            has_desc = true;
            continue;
        }
        sum_fixed += base_width_for(c);
    }
    let mut col_w_mm: Vec<f64> = Vec::with_capacity(cols.len());
    for c in &cols {
        if c == "description" && has_desc {
            let w = (content_w - sum_fixed).max(24.0);
            col_w_mm.push(w);
        } else {
            col_w_mm.push(base_width_for(c));
        }
    }

    // page
    let mut page = page_id;
    let mut layer = layer_id;
    let mut layer_ref = doc.get_page(page).get_layer(layer);
    let mut y = page_h.0 - m_t.0;

    // meta
    draw_text(
        &layer_ref,
        &font_bold,
        "Reimbursable report (open window)",
        m_l.0,
        y,
        fs_title,
        black(),
    );
    y -= 4.0 + row_h;
    draw_text(
        &layer_ref,
        &font_normal,
        &format!("Account: {}", account_label),
        m_l.0,
        y,
        fs_meta,
        black(),
    );
    y -= row_h;

    let period_label = match (&period_from, &period_to) {
        (Some(df), Some(dt)) => format!("Period: {} – {}", iso_to_de(df), iso_to_de(dt)),
        (Some(df), None) => format!("Period: from {}", iso_to_de(df)),
        (None, Some(dt)) => format!("Period: until {}", iso_to_de(dt)),
        _ => "Period: —".to_string(),
    };
    draw_text(
        &layer_ref,
        &font_normal,
        &period_label,
        m_l.0,
        y,
        fs_meta,
        black(),
    );
    y -= row_h;

    let generated_label = chrono::Local::now().format("%d.%m.%Y %H:%M").to_string();
    draw_text(
        &layer_ref,
        &font_normal,
        &format!("Generated: {}", generated_label),
        m_l.0,
        y,
        fs_meta,
        black(),
    );
    y -= row_h + 2.0;

    // header
    draw_table_header(
        &layer_ref, &font_bold, m_l.0, y, content_w, header_h, &cols, &col_w_mm, fs_head, pad,
    );
    y -= header_h;

    // rows
    let mut total_outstanding: f64 = 0.0;

    for (row_idx, row) in rows.iter().enumerate() {
        if y < m_b.0 + (row_h * 3.0) {
            let (np, nl) = doc.add_page(page_w, page_h, "Layer");
            page = np;
            layer = nl;
            layer_ref = doc.get_page(page).get_layer(layer);
            y = page_h.0 - m_t.0;
            draw_table_header(
                &layer_ref, &font_bold, m_l.0, y, content_w, header_h, &cols, &col_w_mm, fs_head,
                pad,
            );
            y -= header_h;
        }

        if row_idx % 2 == 1 {
            draw_rect(
                &layer_ref,
                m_l.0,
                y,
                content_w,
                row_h,
                Some(row_alt()),
                None,
            );
        }

        // column borders
        {
            let mut gx = m_l.0;
            draw_rect(&layer_ref, gx, y, 0.1, row_h, None, Some((grid(), 0.18)));
            for w in &col_w_mm {
                gx += *w;
                draw_rect(&layer_ref, gx, y, 0.1, row_h, None, Some((grid(), 0.18)));
            }
        }

        // values
        let mut x = m_l.0;
        for (i, w) in col_w_mm.iter().enumerate() {
            let key = cols[i].as_str();
            if key == "amount" {
                let s_full = format!("{} €", format_amount_eu(row.adj_amount));
                let s = clip_by_max_chars(&s_full, *w, fs_cell, pad);
                let color = if row.adj_amount < 0.0 {
                    expense()
                } else {
                    income()
                };
                draw_text(&layer_ref, &font_bold, &s, x + pad, y, fs_cell, color);
            } else {
                let content = match key {
                    "date" => iso_to_de(&row.it.date),
                    "account" => row.it.account_name.clone(),
                    "category" => row.it.category.clone().unwrap_or_default(),
                    "description" => row.desc.clone(),
                    other => other.to_string(),
                };
                let s = clip_for_width_with_font(&font_normal, &content, *w, fs_cell, pad);
                draw_text(&layer_ref, &font_normal, &s, x + pad, y, fs_cell, black());
            }
            x += *w;
        }

        draw_rect(
            &layer_ref,
            m_l.0,
            y,
            content_w,
            0.1,
            None,
            Some((grid(), 0.18)),
        );

        total_outstanding += row.adj_amount;
        y -= row_h;
    }

    // --- Single TOTAL line ---
    if y < m_b.0 + (row_h * 2.0) {
        let (np, nl) = doc.add_page(page_w, page_h, "Layer");
        page = np;
        layer = nl;
        layer_ref = doc.get_page(page).get_layer(layer);
        y = page_h.0 - m_t.0;
    }

    y -= 2.0;
    draw_rect(
        &layer_ref,
        m_l.0,
        y,
        content_w,
        row_h * 1.2,
        Some(total_bg()),
        Some((grid(), 0.3)),
    );

    let label = "Total";
    let value = format!("{} €", format_amount_eu(total_outstanding));
    draw_text(
        &layer_ref,
        &font_bold,
        label,
        m_l.0 + pad,
        y,
        fs_head,
        black(),
    );
    let rx = text_right_x(m_l.0, content_w, &font_bold, &value, fs_head, pad);
    let col = if total_outstanding < 0.0 {
        expense()
    } else {
        income()
    };
    draw_text(&layer_ref, &font_bold, &value, rx, y, fs_head, col);

    let file = File::create(&path).map_err(|e| e.to_string())?;
    doc.save(&mut BufWriter::new(file))
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
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

#[tauri::command]
async fn open_database(
    state: State<'_, AppState>,
    db_path: String,
    passphrase: String,
) -> Result<(), String> {
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

    // Migrate and swap in
    if let Err(e) = sqlx::migrate!("./migrations").run(&pool).await {
        return Err(e.to_string());
    }
    *state.pool.write().await = pool;
    Ok(())
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
fn system_theme() -> String {
    match dark_light::detect() {
        dark_light::Mode::Dark => "dark".into(),
        dark_light::Mode::Light => "light".into(),
        dark_light::Mode::Default => "light".into(),
    }
}


pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
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

            app.manage(AppState {
                pool: Arc::new(RwLock::new(pool)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // NEW login commands
            open_database,
            create_database,
            close_database,
            // (keep your existing commands)
            add_account,
            list_accounts,
            list_transactions,
            add_transaction,
            update_transaction,
            delete_transaction,
            delete_account,
            update_account,
            list_categories,
            add_category,
            update_category,
            delete_category,
            search_transactions,
            export_transactions_xlsx,
            export_transactions_pdf,
            export_reimbursable_report_xlsx,
            export_reimbursable_report_pdf,
            list_transactions_all,
            is_database_open,
            system_theme
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
