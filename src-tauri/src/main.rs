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

  let download_dir = tauri::api::path::download_dir().ok_or("No downloads directory")?;
  let ts = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
  let path = PathBuf::from(download_dir).join(format!("transactions_{}.xlsx", ts));

  let cols = columns.unwrap_or_else(|| {
    vec!["date".into(), "account".into(), "category".into(), "description".into(), "amount".into()]
  });

  let mut wb = rust_xlsxwriter::Workbook::new();
  let sheet = wb.add_worksheet();

  for (i, name) in cols.iter().enumerate() {
    sheet.write_string(0, i as u16, name).map_err(|e| e.to_string())?;
  }
  for (r, item) in items.iter().enumerate() {
    let row = (r + 1) as u32;
    for (c, name) in cols.iter().enumerate() {
      let res = match name.as_str() {
        "date"        => sheet.write_string(row, c as u16, &item.date),
        "account"     => sheet.write_string(row, c as u16, &item.account_name),
        "category"    => sheet.write_string(row, c as u16, item.category.as_deref().unwrap_or("")),
        "description" => sheet.write_string(row, c as u16, item.description.as_deref().unwrap_or("")),
        "amount"      => sheet.write_number(row, c as u16, item.amount),
        _             => sheet.write_string(row, c as u16, ""),
      };
      res.map_err(|e| e.to_string())?;
    }
  }

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
