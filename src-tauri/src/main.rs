#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use sqlx::{Arguments};
use serde::{Deserialize, Serialize};
use sqlx::{
  sqlite::{SqliteArguments, SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
  QueryBuilder, Row, Sqlite, SqlitePool,
};
use tauri::{Manager, State};

#[derive(Clone)]
struct AppState {
  pool: SqlitePool,
}

/* ---------- Existing Asset types (ok to keep if you still use them) ---------- */
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

/* ---------------------- New Finance domain types ---------------------- */
#[derive(Debug, Serialize, sqlx::FromRow)]
struct AccountOut {
  id: i64,
  name: String,
  color: Option<String>,

  // column is 'account_type' in SQL, but JSON should be 'type'
  #[sqlx(rename = "account_type")]
  #[serde(rename = "type")]
  r#type: String,       // "standard" | "reimbursable"

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
  description: Option<String>,           // "Notes" in the UI
  amount: f64,
  reimbursement_account_id: Option<i64>,
  reimbursement_account_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NewTransaction {
  account_id: i64,
  date: String,                          // 'YYYY-MM-DD'
  description: Option<String>,
  amount: f64,
  category: Option<String>,
  reimbursement_account_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct UpdateTransaction {
  id: i64,

  account_id: Option<i64>,
  date: Option<String>,          // "YYYY-MM-DD"
  description: Option<String>,
  amount: Option<f64>,
  category: Option<String>,

  // Tri-state:
  // - omit field         => don't touch column
  // - send null          => SET reimbursement_account_id = NULL
  // - send number (i64)  => SET reimbursement_account_id = <id>
  #[serde(default)]
  reimbursement_account_id: Option<Option<i64>>,
}

/* ---------------------- Categories (DB-level unique) ---------------------- */
#[derive(Debug, Serialize, sqlx::FromRow)]
struct Category { id: i64, name: String }

/// Map an optional category *name* to an optional `categories.id`.
/// - Some("Groceries") -> get/create id (case-insensitive unique)
/// - Some("") / whitespace -> Ok(None)  (clear)
/// - None -> Ok(None)                    (leave unchanged unless you set explicitly)
async fn get_or_create_category_id(
  pool: &SqlitePool,
  name_opt: Option<String>,
) -> Result<Option<i64>, sqlx::Error> {
  let name = match name_opt.map(|s| s.trim().to_string()) {
    Some(s) if !s.is_empty() => s,
    _ => return Ok(None),
  };

  // Insert if missing (COLLATE NOCASE UNIQUE)
  sqlx::query("INSERT OR IGNORE INTO categories(name) VALUES (?)")
    .bind(&name)
    .execute(pool)
    .await?;

  // make sure you also have: use sqlx::Row;
  let rec = sqlx::query("SELECT id FROM categories WHERE name = ? COLLATE NOCASE")
    .bind(&name)
    .fetch_one(pool)
    .await?;

  // before: Ok(rec.get::<i64, _>(0))
  Ok(Some(rec.get::<i64, _>(0)))  // <-- wrap in Some(...)

}

/* ---------------------- Asset commands (unchanged runtime queries) ---------------------- */
#[tauri::command]
async fn add_asset(state: State<'_, AppState>, input: NewAsset) -> Result<i64, String> {
  let rec = sqlx::query(
    r#"
    INSERT INTO assets (name, category, purchase_date, value, notes)
    VALUES (?1, ?2, ?3, ?4, ?5);
    "#,
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
  let rows = sqlx::query_as::<_, Asset>(
    r#"
    SELECT id, name, category, purchase_date, value, notes, created_at, updated_at
    FROM assets
    ORDER BY created_at DESC, id DESC;
    "#,
  )
  .fetch_all(&state.pool)
  .await
  .map_err(|e| e.to_string())?;
  Ok(rows)
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

/* ---------------------- New: Finance commands ---------------------- */
#[tauri::command]
async fn add_account(state: tauri::State<'_, AppState>, input: NewAccountInput) -> Result<i64, String> {
  // 1) Insert account with type
  let rec = sqlx::query(
    "INSERT INTO accounts (name, color, type) VALUES (?1, ?2, ?3);"
  )
  .bind(&input.name)
  .bind(&input.color)
  .bind(&input.account_type) // store as text
  .execute(&state.pool).await
  .map_err(|e| e.to_string())?;

  let account_id = rec.last_insert_rowid();

  // 2) If initial balance provided and non-zero, create an initial transaction
  if let Some(amount) = input.initial_balance {
    if amount != 0.0 {
      // YYYY-MM-DD
      let date = chrono::Local::now().format("%Y-%m-%d").to_string();
      sqlx::query(
        r#"
        INSERT INTO transactions (account_id, date, description, amount)
        VALUES (?1, ?2, ?3, ?4);
        "#
      )
      .bind(account_id)
      .bind(date)
      .bind("Initial balance")
      .bind(amount) // positive = credit, negative = debit
      .execute(&state.pool).await
      .map_err(|e| e.to_string())?;
    }
  }

  Ok(account_id)
}

#[tauri::command]
async fn list_accounts(state: State<'_, AppState>) -> Result<Vec<AccountOut>, String> {
  let rows = sqlx::query_as::<_, AccountOut>(
    r#"
    SELECT
      a.id,
      a.name,
      a.color,
      a.type AS account_type,                  -- ← alias to 'account_type'
      COALESCE(SUM(t.amount), 0.0) AS balance
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id
    GROUP BY a.id, a.name, a.color, a.type
    ORDER BY a.name COLLATE NOCASE ASC;
    "#
  )
  .fetch_all(&state.pool).await
  .map_err(|e| e.to_string())?;
  Ok(rows)
}

#[tauri::command]
async fn list_transactions(state: State<'_, AppState>, limit: Option<i64>) -> Result<Vec<TransactionOut>, String> {
  let lim = limit.unwrap_or(20);
  let rows = sqlx::query_as::<_, TransactionOut>(
    r#"
    SELECT
      t.id,
      t.account_id,
      a.name  AS account_name,
      a.color AS account_color,
      t.date,
      COALESCE(c.name, t.category) AS category,   -- ← from categories table, fallback to legacy text
      t.description,
      t.amount,
      t.reimbursement_account_id,
      r.name  AS reimbursement_account_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN accounts r ON r.id = t.reimbursement_account_id
    LEFT JOIN categories c ON c.id = t.category_id
    ORDER BY t.date DESC, t.id DESC
    LIMIT ?1;
    "#
  )
  .bind(lim)
  .fetch_all(&state.pool).await
  .map_err(|e| e.to_string())?;
  Ok(rows)
}

#[tauri::command]
async fn add_transaction(state: State<'_, AppState>, input: NewTransaction) -> Result<i64, String> {
  let cat_id = get_or_create_category_id(&state.pool, input.category.clone())
    .await
    .map_err(|e| e.to_string())?;

  let rec = sqlx::query(
    r#"
    INSERT INTO transactions (account_id, date, description, amount, category_id, reimbursement_account_id)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6);
    "#
  )
  .bind(input.account_id)
  .bind(input.date)
  .bind(input.description)
  .bind(input.amount)
  .bind(cat_id)                          // ← DB-level category
  .bind(input.reimbursement_account_id)
  .execute(&state.pool).await
  .map_err(|e| e.to_string())?;
  Ok(rec.last_insert_rowid())
}

#[tauri::command]
async fn update_transaction(
  state: State<'_, AppState>,
  input: UpdateTransaction
) -> Result<bool, String> {
  // Build: UPDATE transactions SET <fields...> WHERE id = ?
  let mut sql = String::from("UPDATE transactions SET ");
  let mut first = true;
  let mut args = SqliteArguments::default();

  // helper (no closures) to append "col = ?"
  fn push_set(sql: &mut String, first: &mut bool, col: &str) {
    if !*first { sql.push_str(", "); }
    *first = false;
    sql.push_str(col);
    sql.push_str(" = ?");
  }

  if let Some(v) = input.account_id {
    push_set(&mut sql, &mut first, "account_id"); args.add(v);
  }
  if let Some(v) = input.date {
    push_set(&mut sql, &mut first, "date"); args.add(v);
  }
  if let Some(v) = input.description {
    push_set(&mut sql, &mut first, "description"); args.add(v);
  }
  if let Some(v) = input.amount {
    push_set(&mut sql, &mut first, "amount"); args.add(v);
  }

  // Category: only if field was present
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

  // Reimbursement tri-state
  match input.reimbursement_account_id {
    Some(Some(id)) => { push_set(&mut sql, &mut first, "reimbursement_account_id"); args.add(id); }
    Some(None) => {
      if !first { sql.push_str(", "); }
      first = false;
      sql.push_str("reimbursement_account_id = NULL");
    }
    None => {}
  }

  if first {
    // nothing to update
    return Ok(false);
  }

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

#[derive(Debug, Deserialize)]
struct NewAccountInput {
  name: String,
  color: Option<String>,
  account_type: String,      // "standard" | "reimbursable"
  initial_balance: Option<f64>,
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
  .bind(name)   // None => keep old value
  .bind(color)  // None => keep old value
  .bind(id)
  .execute(&state.pool)
  .await
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

/* ---------------------- Optional: list categories for a chooser ---------------------- */
#[tauri::command]
async fn list_categories(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
  sqlx::query_as::<_, Category>("SELECT id, name FROM categories ORDER BY name COLLATE NOCASE")
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())
}

/* ---------------------- App setup (unchanged connect, runs migrations) ---------------------- */
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
      add_account, list_accounts, list_transactions, add_transaction, update_transaction, delete_transaction,
      update_account, delete_account,
      // categories
      list_categories,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn main() { run(); }
