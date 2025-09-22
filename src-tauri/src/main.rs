
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    SqlitePool,
    QueryBuilder,
};

use tauri::{Manager, State};

#[derive(Clone)]
struct AppState {
  pool: SqlitePool,
}

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
  purchase_date: Option<String>, // ISO date YYYY-MM-DD
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
  // Build dynamic SQL using QueryBuilder to keep types safe
  let mut qb = QueryBuilder::<sqlx::Sqlite>::new("UPDATE assets SET ");
  let mut any_change = false;

  {
    let mut separated = qb.separated(", ");
    if let Some(name) = input.name {
      any_change = true;
      separated.push("name = ").push_bind(name);
    }
    if let Some(category) = input.category {
      any_change = true;
      separated.push("category = ").push_bind(category);
    }
    if let Some(purchase_date) = input.purchase_date {
      any_change = true;
      separated.push("purchase_date = ").push_bind(purchase_date);
    }
    if let Some(value) = input.value {
      any_change = true;
      separated.push("value = ").push_bind(value);
    }
    if let Some(notes) = input.notes {
      any_change = true;
      separated.push("notes = ").push_bind(notes);
    }

    if !any_change {
      // Nothing to update
      return Ok(false);
    }

    // Always bump the timestamp
    separated.push("updated_at = CURRENT_TIMESTAMP");
  }

  qb.push(" WHERE id = ").push_bind(input.id);

  let res = qb
    .build()
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

  Ok(res.rows_affected() > 0)
}

fn ensure_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let base = app
    .path_resolver()
    .app_data_dir()
    .ok_or_else(|| "Failed to resolve app data dir".to_string())?;
  fs::create_dir_all(&base).map_err(|e| e.to_string())?;
  let db = base.join("assettracker.db");
  Ok(db)
}

fn db_url(db_path: &PathBuf) -> String {
  format!("sqlite://{}", db_path.to_string_lossy())
}

pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let handle = app.handle();
      let db_path = ensure_db_path(&handle)?;
      let url = db_url(&db_path);

      let pool = tauri::async_runtime::block_on(async move {
      // Ensure DB file gets created and PRAGMAs are set at connect time
      let options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);

      let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

  // Run embedded migrations
  sqlx::migrate!("./migrations").run(&pool).await?;
  Ok::<SqlitePool, sqlx::Error>(pool)
}).map_err(|e| e.to_string())?;

      app.manage(AppState{ pool });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![add_asset, list_assets, delete_asset, update_asset])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn main() {
  run();
}
