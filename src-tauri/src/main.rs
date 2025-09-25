#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use printpdf::{Mm, PdfLayerReference, Line, Point, Color, Rgb, IndirectFontRef};
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
  let sheet = wb.add_worksheet();

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

#[tauri::command]
async fn export_transactions_pdf(
  state: tauri::State<'_, AppState>,
  filters: TxSearch,
  columns: Option<Vec<String>>,
) -> Result<String, String> {
  use printpdf::{PdfDocument, Mm, BuiltinFont, IndirectFontRef};
  use std::io::{BufWriter, Cursor};
  use std::fs::File;

  /* ---------- fetch rows (respect current filters + sort) ---------- */
  let mut where_sql = String::new();
  let mut args: Vec<BindArg> = Vec::new();
  build_where(&filters, &mut where_sql, &mut args);
  let order_sql = build_order(&filters);

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

  /* ---------- metadata strings ---------- */
  let account_label = if let Some(acc_id) = filters.account_id {
    let name: Option<(String,)> = sqlx::query_as("SELECT name FROM accounts WHERE id = ?")
      .bind(acc_id)
      .fetch_optional(&state.pool).await
      .map_err(|e| e.to_string())?;
    name.map(|(n,)| n).unwrap_or_else(|| format!("Account #{}", acc_id))
  } else {
    "All accounts".to_string()
  };

  let timespan_label = match (&filters.date_from, &filters.date_to) {
    (Some(df), Some(dt)) => format!("{} – {}", iso_to_de(df), iso_to_de(dt)),
    (Some(df), None)     => format!("from {}", iso_to_de(df)),
    (None, Some(dt))     => format!("until {}", iso_to_de(dt)),
    _                    => "All time".to_string(),
  };

  let generated_label = chrono::Local::now().format("%d.%m.%Y %H:%M").to_string();

  /* ---------- output path ---------- */
  let download_dir = tauri::api::path::download_dir().ok_or("No downloads directory")?;
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

  let (doc, page_id, layer_id) = PdfDocument::new("Transactions Export", page_w, page_h, "Layer 1");

  /* ---------- fonts (embed DejaVu if present) ---------- */
  fn load_font(doc: &printpdf::PdfDocumentReference, file: &str, fallback: BuiltinFont)
    -> Result<IndirectFontRef, String>
  {
    let path = format!("{}/assets/{}", env!("CARGO_MANIFEST_DIR"), file);
    match std::fs::read(&path) {
      Ok(bytes) => doc.add_external_font(Cursor::new(bytes)).map_err(|e| e.to_string()),
      Err(_)    => doc.add_builtin_font(fallback).map_err(|e| e.to_string()),
    }
  }
  let font_normal = load_font(&doc, "DejaVuSans.ttf", BuiltinFont::Helvetica)?;
  let font_bold   = load_font(&doc, "DejaVuSans-Bold.ttf", BuiltinFont::HelveticaBold)?;

  /* ---------- sizes ---------- */
  let fs_title  = 13.0;
  let fs_meta   = 9.5;
  let fs_head   = 10.2;
  let fs_cell   = 9.7;
  let header_h  = 9.0;
  let row_h     = 7.2;
  let pad       = 1.8; // cell inner padding (mm)

  /* ---------- columns ---------- */
  let cols: Vec<String> = columns.unwrap_or_else(|| {
    vec!["date".into(), "account".into(), "category".into(), "description".into(), "amount".into()]
  });

  fn base_width_for(col: &str) -> f64 {
    match col {
      "date"        => 24.0,
      "account"     => 36.0,
      "category"    => 36.0,
      "amount"      => 28.0,
      _             => 24.0,
    }
  }
  // compute widths (description expands)
  let mut sum_fixed = 0.0;
  let mut has_desc = false;
  for c in &cols {
    if c == "description" { has_desc = true; continue; }
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
  draw_text(&layer_ref, &font_bold, "Transactions (filtered export)", m_l.0, y, fs_title, black());
  y -= 4.0 + row_h;
  draw_text(&layer_ref, &font_normal, &format!("Account: {}",   account_label),  m_l.0, y, fs_meta, black()); y -= row_h;
  draw_text(&layer_ref, &font_normal, &format!("Time span: {}", timespan_label), m_l.0, y, fs_meta, black()); y -= row_h;
  draw_text(&layer_ref, &font_normal, &format!("Generated: {}", generated_label),m_l.0, y, fs_meta, black()); y -= row_h + 2.0;

  /* ---------- header band ---------- */
  draw_table_header(&layer_ref, &font_bold, m_l.0, y, content_w, header_h, &cols, &col_w_mm, fs_head, pad);
  y -= header_h;

  /* ---------- rows ---------- */
  let mut sum_income: f64 = 0.0;
  let mut sum_expense: f64 = 0.0;

  for (row_idx, it) in items.iter().enumerate() {
    // page break (keep some space for summary)
    if y < m_b.0 + (row_h * 4.0) {
      let (np, nl) = doc.add_page(page_w, page_h, "Layer");
      page = np;
      layer = nl;
      layer_ref = doc.get_page(page).get_layer(layer);
      y = page_h.0 - m_t.0;
      draw_table_header(&layer_ref, &font_bold, m_l.0, y, content_w, header_h, &cols, &col_w_mm, fs_head, pad);
      y -= header_h;
    }

    // zebra bg
    if row_idx % 2 == 1 { draw_rect(&layer_ref, m_l.0, y, content_w, row_h, Some(row_alt()), None); }

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
          "date"        => iso_to_de(&it.date),
          "account"     => it.account_name.clone(),
          "category"    => it.category.clone().unwrap_or_default(),
          "description" => it.description.clone().unwrap_or_default(),
          other         => other.to_string(),
        };
        let s = clip_for_width_with_font(&font_normal, &content, *w, fs_cell, pad);
        draw_text(&layer_ref, &font_normal, &s, x + pad, y, fs_cell, black());
      }
      x += *w;
    }

    // horizontal hairline
    draw_rect(&layer_ref, m_l.0, y, content_w, 0.1, None, Some((grid(), 0.18)));

    if it.amount > 0.0 { sum_income += it.amount; }
    if it.amount < 0.0 { sum_expense += it.amount; }

    y -= row_h;
  }

  /* ---------- summary ---------- */
  let saldo = sum_income + sum_expense;
  if y < m_b.0 + (row_h * 4.0) {
    let (np, nl) = doc.add_page(page_w, page_h, "Layer");
    page = np;
    layer = nl;
    layer_ref = doc.get_page(page).get_layer(layer);
    y = page_h.0 - m_t.0;
  }

  y -= 2.0;
  draw_rect(&layer_ref, m_l.0, y, content_w, row_h * 3.0, Some(total_bg()), Some((grid(), 0.3)));

  // income
  {
    let label = "Total income";
    let value = format!("{} €", format_amount_eu(sum_income));
    draw_text(&layer_ref, &font_bold, label, m_l.0 + pad, y, fs_head, black());
    let rx = text_right_x(m_l.0, content_w, &font_bold, &value, fs_head, pad);
    draw_text(&layer_ref, &font_bold, &value, rx, y, fs_head, income());
    y -= row_h;
  }
  // expenses
  {
    let label = "Total expenses";
    let value = format!("{} €", format_amount_eu(sum_expense));
    draw_text(&layer_ref, &font_bold, label, m_l.0 + pad, y, fs_head, black());
    let rx = text_right_x(m_l.0, content_w, &font_bold, &value, fs_head, pad);
    draw_text(&layer_ref, &font_bold, &value, rx, y, fs_head, expense());
    y -= row_h;
  }
  // saldo
  {
    let label = "Saldo";
    let value = format!("{} €", format_amount_eu(saldo));
    draw_text(&layer_ref, &font_bold, label, m_l.0 + pad, y, fs_head, black());
    let rx = text_right_x(m_l.0, content_w, &font_bold, &value, fs_head, pad);
    let s_col = if saldo < 0.0 { expense() } else { income() };
    draw_text(&layer_ref, &font_bold, &value, rx, y, fs_head, s_col);
  }

  // save
  let file = File::create(&path).map_err(|e| e.to_string())?;
  doc.save(&mut BufWriter::new(file)).map_err(|e| e.to_string())?;
  Ok(path.to_string_lossy().to_string())
}

/* ======================================================================
   Helpers (colors, drawing, layout, formatting, clipping, alignment)
   ====================================================================== */

fn black()     -> Color { Color::Rgb(Rgb::new(0.0, 0.0, 0.0, None)) }
fn grid()      -> Color { Color::Rgb(Rgb::new(0.84, 0.85, 0.86, None)) }   // #D6D6DB
fn header_bg() -> Color { Color::Rgb(Rgb::new(0.95, 0.96, 0.98, None)) }
fn row_alt()   -> Color { Color::Rgb(Rgb::new(0.985, 0.985, 0.985, None)) }
fn income()    -> Color { Color::Rgb(Rgb::new(0.09, 0.64, 0.29, None)) }   // green-600
fn expense()   -> Color { Color::Rgb(Rgb::new(0.86, 0.15, 0.15, None)) }   // red-600
fn total_bg()  -> Color { Color::Rgb(Rgb::new(0.94, 0.97, 0.94, None)) }   // greenish tint

fn draw_rect(
  layer: &PdfLayerReference,
  x: f64, y_top: f64, w: f64, h: f64,
  fill: Option<Color>, stroke: Option<(Color, f64)>
) {
  let pts = vec![
    (Point::new(Mm(x),     Mm(y_top)),     false),
    (Point::new(Mm(x + w), Mm(y_top)),     false),
    (Point::new(Mm(x + w), Mm(y_top - h)), false),
    (Point::new(Mm(x),     Mm(y_top - h)), false),
  ];
  let shape = Line {
    points: pts,
    is_closed: true,
    has_fill: fill.is_some(),
    has_stroke: stroke.is_some(),
    is_clipping_path: false,
  };
  if let Some(c) = fill { layer.set_fill_color(c); }
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
  x: f64, y_top: f64,
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
  x0: f64, y_top: f64, content_w: f64, header_h: f64,
  cols: &[String], col_w_mm: &[f64], fs_head: f64, pad: f64
) {
  draw_rect(layer, x0, y_top, content_w, header_h, Some(header_bg()), Some((grid(), 0.3)));
  draw_rect(layer, x0,            y_top, 0.1,       header_h, None, Some((grid(), 0.3)));
  draw_rect(layer, x0 + content_w,y_top, 0.1,       header_h, None, Some((grid(), 0.3)));

  let mut x = x0;
  for (i, w) in col_w_mm.iter().enumerate() {
    if i > 0 { draw_rect(layer, x, y_top, 0.1, header_h, None, Some((grid(), 0.3))); }
    let label = match cols[i].as_str() {
      "date" => "Date", "account" => "Account", "category" => "Category",
      "description" => "Notes", "amount" => "Value", other => other
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
    let y = &iso[0..4]; let m = &iso[5..7]; let d = &iso[8..10];
    format!("{}.{}.{}", d, m, y)
  } else { iso.to_string() }
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
  if s.chars().count() <= max_chars { return s.to_string(); }
  let mut out = String::new();
  let mut count = 0usize;
  for ch in s.chars() {
    if count + 1 >= max_chars { break; }
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
    if w > max_inner { w = max_inner; }

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
        ' '       => base * 0.55,
        // minus sign
        '-'       => base * 0.70,
        // euro tends to be a bit wider
        '€'       => base * 1.18,
        // typical wide letters fall back here; we mostly print numbers anyway
        _         => base * 1.00,
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
        if acc + w + ell_w > avail { break; }
        out.push(ch);
        acc += w;
    }
    out.push(ell);
    out
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
      search_transactions, export_transactions_xlsx, export_transactions_pdf
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn main() { run(); }
