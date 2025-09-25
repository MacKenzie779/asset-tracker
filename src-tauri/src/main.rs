#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sqlx::Arguments;
use sqlx::{
  sqlite::{SqliteArguments, SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
  QueryBuilder, Row, Sqlite, SqlitePool,
};
use tauri::{Manager, State};

#[derive(Clone)]
struct AppState {
  pool: SqlitePool,
}

/* ---------- Assets ---------- */
#[derive(Debug, Serialize, sqlx::FromRow)]
struct Asset {
  id: i64,
  name: String,
  category: Option<String>,
  purchase_date: Option<String>,
  value: f64,
  notes: Option<String>,
  created_at: String,
  updated_at: String,
}
#[derive(Debug, Deserialize)]
struct NewAsset {
  name: String,
  category: Option<String>,
  purchase_date: Option<String>,
  value: f64,
  notes: Option<String>,
}
#[derive(Debug, Deserialize)]
struct UpdateAsset {
  id: i64,
  name: Option<String>,
  category: Option<String>,
  purchase_date: Option<String>,
  value: Option<f64>,
  notes: Option<String>,
}

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

#[derive(Debug, Serialize, sqlx::FromRow)]
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
  offset: Option<i64>,       // if < 0 => compute last page on server
  sort_by: Option<String>,   // "date"|"category"|"description"|"amount"|"account"|"id"
  sort_dir: Option<String>,  // "asc"|"desc"
}

#[derive(Debug, Serialize)]
struct TxSearchResult {
  items: Vec<TransactionOut>,
  total: i64,
  offset: i64,      // effective offset used (for page calc in UI)
  sum_income: f64,
  sum_expense: f64,
}

/* ---------- Categories (DB-level unique) ---------- */
#[derive(Debug, Serialize, sqlx::FromRow)]
struct Category { id: i64, name: String }

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

/* ---------- Asset commands ---------- */
#[tauri::command]
async fn add_asset(state: State<'_, AppState>, input: NewAsset) -> Result<i64, String> {
  let rec = sqlx::query(
    r#"INSERT INTO assets (name, category, purchase_date, value, notes)
       VALUES (?1, ?2, ?3, ?4, ?5);"#,
  )
  .bind(input.name)
  .bind(input.category)
  .bind(input.purchase_date)
  .bind(input.value)
  .bind(input.notes)
  .execute(&state.pool)
  .await
  .map_err(|e| e.to_string())?;
  Ok(rec.last_insert_rowid())
}

#[tauri::command]
async fn list_assets(state: State<'_, AppState>) -> Result<Vec<Asset>, String> {
  sqlx::query_as::<_, Asset>(
    r#"SELECT id, name, category, purchase_date, value, notes, created_at, updated_at
       FROM assets
       ORDER BY created_at DESC, id DESC;"#,
  )
  .fetch_all(&state.pool)
  .await
  .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_asset(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
  let res = sqlx::query("DELETE FROM assets WHERE id = ?1")
    .bind(id)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
  Ok(res.rows_affected() > 0)
}

#[tauri::command]
async fn update_asset(state: State<'_, AppState>, input: UpdateAsset) -> Result<bool, String> {
  let mut qb = QueryBuilder::<Sqlite>::new("UPDATE assets SET ");
  let mut any_change = false;
  {
    let mut s = qb.separated(", ");
    if let Some(name) = input.name { any_change = true; s.push("name = ").push_bind(name); }
    if let Some(category) = input.category { any_change = true; s.push("category = ").push_bind(category); }
    if let Some(purchase_date) = input.purchase_date { any_change = true; s.push("purchase_date = ").push_bind(purchase_date); }
    if let Some(value) = input.value { any_change = true; s.push("value = ").push_bind(value); }
    if let Some(notes) = input.notes { any_change = true; s.push("notes = ").push_bind(notes); }
    if !any_change { return Ok(false); }
    s.push("updated_at = CURRENT_TIMESTAMP");
  }
  qb.push(" WHERE id = ").push_bind(input.id);
  let res = qb.build().execute(&state.pool).await.map_err(|e| e.to_string())?;
  Ok(res.rows_affected() > 0)
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
  let rec = sqlx::query("INSERT INTO accounts (name, color, type) VALUES (?1, ?2, ?3);")
    .bind(&input.name)
    .bind(&input.color)
    .bind(&input.account_type)
    .execute(&state.pool).await
    .map_err(|e| e.to_string())?;
  let account_id = rec.last_insert_rowid();

  if let Some(amount) = input.initial_balance {
    if amount != 0.0 {
      let date = chrono::Local::now().format("%Y-%m-%d").to_string();
      sqlx::query(
        r#"INSERT INTO transactions (account_id, date, description, amount)
           VALUES (?1, ?2, ?3, ?4);"#,
      )
      .bind(account_id)
      .bind(date)
      .bind("Initial balance")
      .bind(amount)
      .execute(&state.pool).await
      .map_err(|e| e.to_string())?;
    }
  }
  Ok(account_id)
}

#[tauri::command]
async fn list_accounts(state: State<'_, AppState>) -> Result<Vec<AccountOut>, String> {
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
    "#
  )
  .fetch_all(&state.pool).await
  .map_err(|e| e.to_string())
}

/* ---------- list_transactions (Home) ordered by newest first ---------- */
#[tauri::command]
async fn list_transactions(state: State<'_, AppState>, limit: Option<i64>) -> Result<Vec<TransactionOut>, String> {
  let lim = limit.unwrap_or(20);
  sqlx::query_as::<_, TransactionOut>(
    r#"
    SELECT
      t.id,
      t.account_id,
      a.name  AS account_name,
      a.color AS account_color,
      t.date,
      COALESCE(c.name, t.category) AS category,
      t.description,
      t.amount
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    ORDER BY DATE(t.date) DESC, t.id DESC
    LIMIT ?1;
    "#
  )
  .bind(lim)
  .fetch_all(&state.pool).await
  .map_err(|e| e.to_string())
}

/* ---------- CRUD ---------- */
#[tauri::command]
async fn add_transaction(state: State<'_, AppState>, input: NewTransaction) -> Result<i64, String> {
  let cat_id = get_or_create_category_id(&state.pool, input.category.clone())
    .await
    .map_err(|e| e.to_string())?;

  let rec = sqlx::query(
    r#"
    INSERT INTO transactions (account_id, date, description, amount, category_id)
    VALUES (?1, ?2, ?3, ?4, ?5);
    "#
  )
  .bind(input.account_id)
  .bind(input.date)
  .bind(input.description)
  .bind(input.amount)
  .bind(cat_id)
  .execute(&state.pool).await
  .map_err(|e| e.to_string())?;
  Ok(rec.last_insert_rowid())
}

#[tauri::command]
async fn update_transaction(
  state: State<'_, AppState>,
  input: UpdateTransaction
) -> Result<bool, String> {
  let mut sql = String::from("UPDATE transactions SET ");
  let mut first = true;
  let mut args = SqliteArguments::default();

  fn push_set(sql: &mut String, first: &mut bool, col: &str) {
    if !*first { sql.push_str(", "); }
    *first = false;
    sql.push_str(col);
    sql.push_str(" = ?");
  }

  if let Some(v) = input.account_id { push_set(&mut sql, &mut first, "account_id"); args.add(v); }
  if let Some(v) = input.date { push_set(&mut sql, &mut first, "date"); args.add(v); }
  if let Some(v) = input.description { push_set(&mut sql, &mut first, "description"); args.add(v); }
  if let Some(v) = input.amount { push_set(&mut sql, &mut first, "amount"); args.add(v); }

  if input.category.is_some() {
    let cat_id = get_or_create_category_id(&state.pool, input.category.clone())
      .await
      .map_err(|e| e.to_string())?;
    match cat_id {
      Some(id) => { push_set(&mut sql, &mut first, "category_id"); args.add(id); }
      None => {
        if !first { sql.push_str(", "); }
        first = false;
        sql.push_str("category_id = NULL");
      }
    }
  }

  if first { return Ok(false); }

  sql.push_str(" WHERE id = ?");
  args.add(input.id);

  let res = sqlx::query_with(&sql, args)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

  Ok(res.rows_affected() > 0)
}

#[tauri::command]
async fn delete_transaction(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
  let res = sqlx::query("DELETE FROM transactions WHERE id = ?1")
    .bind(id)
    .execute(&state.pool).await
    .map_err(|e| e.to_string())?;
  Ok(res.rows_affected() > 0)
}

#[tauri::command]
async fn delete_account(state: tauri::State<'_, AppState>, id: i64) -> Result<bool, String> {
  let res = sqlx::query("DELETE FROM accounts WHERE id = ?1")
    .bind(id)
    .execute(&state.pool).await
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
  let res = sqlx::query(
    r#"
    UPDATE accounts
    SET
      name  = COALESCE(?1, name),
      color = COALESCE(?2, color),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?3;
    "#
  )
  .bind(name)
  .bind(color)
  .bind(id)
  .execute(&state.pool)
  .await
  .map_err(|e| e.to_string())?;

  Ok(res.rows_affected() > 0)
}

/* ---------- Categories list (for chooser) ---------- */
#[tauri::command]
async fn list_categories(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
  sqlx::query_as::<_, Category>("SELECT id, name FROM categories ORDER BY name COLLATE NOCASE")
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())
}

/* ---------- Helpers for search/export ---------- */
enum BindArg { I(i64), S(String) }

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
         OR LOWER(COALESCE(c.name, t.category, '')) LIKE ?) ",
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
    Some("category")    => "COALESCE(c.name, t.category)",
    Some("description") => "t.description",
    Some("amount")      => "t.amount",
    Some("account")     => "a.name",
    Some("id")          => "t.id",
    _                   => "DATE(t.date)", // default
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
     LEFT JOIN categories c ON c.id = t.category_id"
  );
  sql_count.push_str(&where_sql);
  let mut q_count = sqlx::query_scalar::<_, i64>(&sql_count);
  for a in &args {
    match a {
      BindArg::I(v) => { q_count = q_count.bind(*v); }
      BindArg::S(s) => { q_count = q_count.bind(s); }
    }
  }
  let total = q_count.fetch_one(&state.pool).await.map_err(|e| e.to_string())?;

  let limit = filters.limit.unwrap_or(15).max(0);
  let req_offset = filters.offset.unwrap_or(-1);
  let last_offset = if total == 0 || limit == 0 { 0 } else { ((total - 1) / limit) * limit };
  let effective_offset = if req_offset < 0 { last_offset } else if req_offset >= total { last_offset } else { req_offset };

  // Items
  let mut sql_items = String::from(
    "SELECT t.id, t.account_id, a.name AS account_name, a.color AS account_color, \
            t.date, COALESCE(c.name, t.category) AS category, t.description, t.amount \
     FROM transactions t \
     JOIN accounts a ON a.id = t.account_id \
     LEFT JOIN categories c ON c.id = t.category_id"
  );
  sql_items.push_str(&where_sql);
  sql_items.push_str(&order_sql);
  sql_items.push_str(" LIMIT ? OFFSET ? ");

  let mut q_items = sqlx::query_as::<_, TransactionOut>(&sql_items);
  for a in &args {
    match a {
      BindArg::I(v) => { q_items = q_items.bind(*v); }
      BindArg::S(s) => { q_items = q_items.bind(s); }
    }
  }
  q_items = q_items.bind(limit).bind(effective_offset);
  let items = q_items.fetch_all(&state.pool).await.map_err(|e| e.to_string())?;

  // Sums
  let mut sql_sums = String::from(
    "SELECT \
       COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0.0) AS income, \
       COALESCE(SUM(CASE WHEN t.amount < 0 THEN t.amount END), 0.0) AS expense \
     FROM transactions t \
     JOIN accounts a ON a.id = t.account_id \
     LEFT JOIN categories c ON c.id = t.category_id"
  );
  sql_sums.push_str(&where_sql);

  let mut q_sums = sqlx::query_as::<_, (f64, f64)>(&sql_sums);
  for a in &args {
    match a {
      BindArg::I(v) => { q_sums = q_sums.bind(*v); }
      BindArg::S(s) => { q_sums = q_sums.bind(s); }
    }
  }
  let (sum_income, sum_expense) = q_sums.fetch_one(&state.pool).await.map_err(|e| e.to_string())?;

  Ok(TxSearchResult { items, total, offset: effective_offset, sum_income, sum_expense })
}

#[tauri::command]
async fn export_transactions_xlsx(
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
            t.date, COALESCE(c.name, t.category) AS category, t.description, t.amount \
     FROM transactions t \
     JOIN accounts a ON a.id = t.account_id \
     LEFT JOIN categories c ON c.id = t.category_id"
  );
  sql.push_str(&where_sql);
  sql.push_str(&order_sql);

  let mut q = sqlx::query_as::<_, TransactionOut>(&sql);
  for a in &args {
    match a {
      BindArg::I(v) => { q = q.bind(*v); }
      BindArg::S(s) => { q = q.bind(s); }
    }
  }
  let items = q.fetch_all(&state.pool).await.map_err(|e| e.to_string())?;

  /* ---------- Report metadata (Account / Time span / Generated) ---------- */
  // Account label
  let account_label = if let Some(acc_id) = filters.account_id {
    let name_opt = sqlx::query_scalar::<_, String>("SELECT name FROM accounts WHERE id = ?1")
      .bind(acc_id)
      .fetch_optional(&state.pool)
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
    (Some(df), None)     => format!("since {}", fmt_dmy(df)),
    (None, Some(dt))     => format!("until {}", fmt_dmy(dt)),
    _                    => "All time".to_string(),
  };

  let generated_at = Local::now().format("%d.%m.%Y %H:%M").to_string();

  /* ---------- Target file path ---------- */
  let download_dir = tauri::api::path::download_dir().ok_or("No downloads directory")?;
  let ts = Local::now().format("%Y%m%d_%H%M%S").to_string();
  let path = std::path::PathBuf::from(download_dir).join(format!("transactions_{}.xlsx", ts));

  /* ---------- Column selection (stable order) ---------- */
  let mut cols = columns.unwrap_or_else(|| {
    vec!["date".into(), "account".into(), "category".into(), "description".into(), "amount".into()]
  });
  if cols.is_empty() {
    cols = vec!["date".into(), "account".into(), "category".into(), "description".into(), "amount".into()];
  }
  let order = ["date", "account", "category", "description", "amount"];
  cols.sort_by_key(|k| order.iter().position(|x| x == &k.as_str()).unwrap_or(999));

  /* ---------- Workbook + formats ---------- */
  let mut wb = Workbook::new();
  let mut sheet = wb.add_worksheet();

  let title_fmt  = Format::new().set_bold().set_font_size(14);
  let label_fmt  = Format::new().set_bold();
  let header_fmt = Format::new().set_bold();

  // Real Excel dates with fixed display format
  let date_fmt   = Format::new().set_num_format("dd.mm.yyyy");

  // Calm money colors + correct numeric pattern (Excel localizes separators in UI)
  let money_fmt_pos  = Format::new().set_num_format("#,##0.00 \"€\"").set_font_color(Color::RGB(0x1B5E20));
  let money_fmt_neg  = Format::new().set_num_format("#,##0.00 \"€\"").set_font_color(Color::RGB(0xB71C1C));
  let money_fmt_zero = Format::new().set_num_format("#,##0.00 \"€\"").set_font_color(Color::RGB(0x424242));
  let pick_money_fmt = |v: f64| if v > 0.0 { &money_fmt_pos } else if v < 0.0 { &money_fmt_neg } else { &money_fmt_zero };

  /* ---------- Info block at top ---------- */
  let mut current_row: u32 = 0;

  sheet.write_string_with_format(current_row, 0, "Transactions export", &title_fmt)
    .map_err(|e| e.to_string())?;
  current_row += 1;

  sheet.write_string_with_format(current_row, 0, "Account", &label_fmt).map_err(|e| e.to_string())?;
  sheet.write_string(current_row, 1, &account_label).map_err(|e| e.to_string())?;
  current_row += 1;

  sheet.write_string_with_format(current_row, 0, "Time span", &label_fmt).map_err(|e| e.to_string())?;
  sheet.write_string(current_row, 1, &time_span_label).map_err(|e| e.to_string())?;
  current_row += 1;

  sheet.write_string_with_format(current_row, 0, "Generated", &label_fmt).map_err(|e| e.to_string())?;
  sheet.write_string(current_row, 1, &generated_at).map_err(|e| e.to_string())?;
  current_row += 2; // blank line

  /* ---------- Table header ---------- */
  let table_start_row = current_row;
  for (i, key) in cols.iter().enumerate() {
    let label = match key.as_str() {
      "date"        => "Date",
      "account"     => "Account",
      "category"    => "Category",
      "description" => "Notes",
      "amount"      => "Value",
      _             => key,
    };
    sheet.write_string_with_format(table_start_row, i as u16, label, &header_fmt)
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

  let header_labels: Vec<&str> = cols.iter().map(|k| match k.as_str() {
    "date" => "Date", "account" => "Account", "category" => "Category",
    "description" => "Notes", "amount" => "Value", _ => k
  }).collect();
  let mut col_widths: Vec<usize> = header_labels.iter().map(|s| s.chars().count()).collect();

  /* ---------- Rows + totals ---------- */
  let mut sum_income: f64 = 0.0;
  let mut sum_expense: f64 = 0.0;

  for (r, item) in items.iter().enumerate() {
    let row = table_start_row + 1 + r as u32;

    for (c, key) in cols.iter().enumerate() {
      match key.as_str() {
        "date" => {
          if let Ok(nd) = NaiveDate::parse_from_str(&item.date, "%Y-%m-%d") {
            // rust_xlsxwriter 0.69 expects (u16, u8, u8)
            let y: u16 = u16::try_from(nd.year()).map_err(|_| "Year out of range for ExcelDateTime")?;
            let m: u8  = u8::try_from(nd.month()).map_err(|_| "Month out of range for ExcelDateTime")?;
            let d: u8  = u8::try_from(nd.day()).map_err(|_| "Day out of range for ExcelDateTime")?;
            let dt = ExcelDateTime::from_ymd(y, m, d).map_err(|e| e.to_string())?;
            sheet.write_datetime_with_format(row, c as u16, &dt, &date_fmt).map_err(|e| e.to_string())?;
          } else {
            sheet.write_string(row, c as u16, &item.date).map_err(|e| e.to_string())?;
          }
          col_widths[c] = col_widths[c].max(10); // dd.mm.yyyy
        }
        "account" => {
          sheet.write_string(row, c as u16, &item.account_name).map_err(|e| e.to_string())?;
          col_widths[c] = col_widths[c].max(item.account_name.chars().count());
        }
        "category" => {
          let s = item.category.as_deref().unwrap_or("");
          sheet.write_string(row, c as u16, s).map_err(|e| e.to_string())?;
          col_widths[c] = col_widths[c].max(s.chars().count());
        }
        "description" => {
          let s = item.description.as_deref().unwrap_or("");
          sheet.write_string(row, c as u16, s).map_err(|e| e.to_string())?;
          col_widths[c] = col_widths[c].max(s.chars().count());
        }
        "amount" => {
          let fmt = pick_money_fmt(item.amount);
          sheet.write_number_with_format(row, c as u16, item.amount, fmt).map_err(|e| e.to_string())?;
          col_widths[c] = col_widths[c].max(display_len_amount(item.amount));
        }
        _ => {
          sheet.write_string(row, c as u16, "").map_err(|e| e.to_string())?;
        }
      }
    }

    if item.amount > 0.0 { sum_income += item.amount; }
    if item.amount < 0.0 { sum_expense += item.amount; } // negative
  }

  /* ---------- Summary ---------- */
  let summary_row_start = table_start_row + 1 + items.len() as u32 + 1;
  let value_col: u16 = (cols.len().saturating_sub(1)) as u16; // last visible column
  let label_col: u16 = 0;

  sheet.write_string_with_format(summary_row_start,     label_col, "Total income",   &label_fmt).map_err(|e| e.to_string())?;
  sheet.write_number_with_format(summary_row_start,     value_col, sum_income, pick_money_fmt(sum_income)).map_err(|e| e.to_string())?;
  col_widths[value_col as usize] = col_widths[value_col as usize].max(display_len_amount(sum_income));

  sheet.write_string_with_format(summary_row_start + 1, label_col, "Total expenses", &label_fmt).map_err(|e| e.to_string())?;
  sheet.write_number_with_format(summary_row_start + 1, value_col, sum_expense, pick_money_fmt(sum_expense)).map_err(|e| e.to_string())?;
  col_widths[value_col as usize] = col_widths[value_col as usize].max(display_len_amount(sum_expense));

  let saldo = sum_income + sum_expense;
  sheet.write_string_with_format(summary_row_start + 2, label_col, "Saldo",          &label_fmt).map_err(|e| e.to_string())?;
  sheet.write_number_with_format(summary_row_start + 2, value_col, saldo, pick_money_fmt(saldo)).map_err(|e| e.to_string())?;
  col_widths[value_col as usize] = col_widths[value_col as usize].max(display_len_amount(saldo));

  /* ---------- Autosize columns (use Result to avoid warnings) ---------- */
  for (c, w) in col_widths.iter().enumerate() {
    // Add small padding and clamp to a reasonable max
    let width = ((*w as f64) + 2.0).min(60.0);
    sheet.set_column_width(c as u16, width).map_err(|e| e.to_string())?;
  }

  /* ---------- Save ---------- */
  wb.save(&path).map_err(|e| e.to_string())?;
  Ok(path.to_string_lossy().to_string())
}





/* ---------- App setup ---------- */
fn ensure_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let base = app.path_resolver().app_data_dir().ok_or_else(|| "Failed to resolve app data dir".to_string())?;
  fs::create_dir_all(&base).map_err(|e| e.to_string())?;
  Ok(base.join("assettracker.db"))
}

pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let db_path = ensure_db_path(&app.handle())?;
      let pool = tauri::async_runtime::block_on(async move {
        let options = SqliteConnectOptions::new()
          .filename(&db_path)
          .create_if_missing(true)
          .journal_mode(SqliteJournalMode::Wal)
          .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
          .max_connections(5)
          .connect_with(options).await?;
        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok::<SqlitePool, sqlx::Error>(pool)
      }).map_err(|e| e.to_string())?;
      app.manage(AppState { pool });
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      // assets
      add_asset, list_assets, delete_asset, update_asset,
      // finance
      add_account, list_accounts, list_transactions, add_transaction, update_transaction, delete_transaction, delete_account, update_account,
      // categories
      list_categories,
      // search/export
      search_transactions, export_transactions_xlsx,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn main() { run(); }
