// src-tauri/src/tx_search_export.rs

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use tauri::State;

use crate::AppState;

#[derive(Debug, FromRow, Serialize)]
pub struct TransactionOut {
    pub id: i64,
    pub account_id: i64,
    pub account_name: String,
    pub account_color: Option<String>,
    pub date: String, // 'YYYY-MM-DD'
    pub category: Option<String>,
    pub description: Option<String>,
    pub amount: f64,
}

#[derive(Debug, Deserialize)]
pub struct TxSearch {
    pub query: Option<String>,
    pub account_id: Option<i64>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub tx_type: Option<String>, // all | income | expense
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct TxSearchResult {
    pub items: Vec<TransactionOut>,
    pub total: i64,
    pub sum_income: f64,
    pub sum_expense: f64,
}

enum Arg {
    I(i64),
    S(String),
}

fn build_where(filters: &TxSearch, where_sql: &mut String, args: &mut Vec<Arg>) {
    where_sql.push_str(" WHERE 1=1 ");
    if let Some(acc_id) = filters.account_id {
        where_sql.push_str(" AND t.account_id = ? ");
        args.push(Arg::I(acc_id));
    }
    if let Some(ref df) = filters.date_from {
        where_sql.push_str(" AND t.date >= ? ");
        args.push(Arg::S(df.clone()));
    }
    if let Some(ref dt) = filters.date_to {
        where_sql.push_str(" AND t.date <= ? ");
        args.push(Arg::S(dt.clone()));
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
               OR LOWER(COALESCE(c.name, t.category, '')) LIKE ? \
               OR LOWER(a.name) LIKE ?) ",
        );
        args.push(Arg::S(like.clone()));
        args.push(Arg::S(like.clone()));
        args.push(Arg::S(like));
    }
}

#[tauri::command]
pub async fn search_transactions(
    state: State<'_, AppState>,
    filters: TxSearch,
) -> Result<TxSearchResult, String> {
    let mut where_sql = String::new();
    let mut args: Vec<Arg> = Vec::new();
    build_where(&filters, &mut where_sql, &mut args);

    let mut sql_items = String::from(
        "SELECT t.id, t.account_id, a.name AS account_name, a.color AS account_color, \
                t.date, COALESCE(c.name, t.category) AS category, t.description, t.amount \
         FROM transactions t \
         JOIN accounts a ON a.id = t.account_id \
         LEFT JOIN categories c ON c.id = t.category_id",
    );
    sql_items.push_str(&where_sql);
    sql_items.push_str(" ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ? ");

    let mut q_items = sqlx::query_as::<_, TransactionOut>(&sql_items);
    for a in &args {
        match a {
            Arg::I(v) => q_items = q_items.bind(*v),
            Arg::S(s) => q_items = q_items.bind(s),
        };
    }
    let limit = filters.limit.unwrap_or(25);
    let offset = filters.offset.unwrap_or(0);
    q_items = q_items.bind(limit).bind(offset);

    let items = q_items
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut sql_count = String::from(
        "SELECT COUNT(*) \
         FROM transactions t \
         JOIN accounts a ON a.id = t.account_id \
         LEFT JOIN categories c ON c.id = t.category_id",
    );
    sql_count.push_str(&where_sql);

    let mut q_count = sqlx::query_scalar::<_, i64>(&sql_count);
    for a in &args {
        match a {
            Arg::I(v) => q_count = q_count.bind(*v),
            Arg::S(s) => q_count = q_count.bind(s),
        };
    }
    let total = q_count
        .fetch_one(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut sql_sums = String::from(
        "SELECT \
           COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0.0) AS income, \
           COALESCE(SUM(CASE WHEN t.amount < 0 THEN t.amount END), 0.0) AS expense \
         FROM transactions t \
         JOIN accounts a ON a.id = t.account_id \
         LEFT JOIN categories c ON c.id = t.category_id",
    );
    sql_sums.push_str(&where_sql);

    let mut q_sums = sqlx::query_as::<_, (f64, f64)>(&sql_sums);
    for a in &args {
        match a {
            Arg::I(v) => q_sums = q_sums.bind(*v),
            Arg::S(s) => q_sums = q_sums.bind(s),
        };
    }
    let (sum_income, sum_expense) = q_sums
        .fetch_one(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(TxSearchResult {
        items,
        total,
        sum_income,
        sum_expense,
    })
}

#[tauri::command]
pub async fn export_transactions_xlsx(
    state: State<'_, AppState>,
    filters: TxSearch,
    columns: Option<Vec<String>>,
) -> Result<String, String> {
    let mut where_sql = String::new();
    let mut args: Vec<Arg> = Vec::new();
    build_where(&filters, &mut where_sql, &mut args);

    let mut sql = String::from(
        "SELECT t.id, t.account_id, a.name AS account_name, a.color AS account_color, \
                t.date, COALESCE(c.name, t.category) AS category, t.description, t.amount \
         FROM transactions t \
         JOIN accounts a ON a.id = t.account_id \
         LEFT JOIN categories c ON c.id = t.category_id",
    );
    sql.push_str(&where_sql);
    sql.push_str(" ORDER BY t.date DESC, t.id DESC ");

    let mut q = sqlx::query_as::<_, TransactionOut>(&sql);
    for a in &args {
        match a {
            Arg::I(v) => q = q.bind(*v),
            Arg::S(s) => q = q.bind(s),
        };
    }
    let items = q
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    let download_dir = tauri::api::path::download_dir().ok_or("No downloads directory")?;
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let path = std::path::PathBuf::from(download_dir).join(format!("transactions_{}.xlsx", ts));

    let cols = columns.unwrap_or_else(|| {
        vec![
            "date".into(),
            "account".into(),
            "category".into(),
            "description".into(),
            "amount".into(),
        ]
    });

    let mut wb = rust_xlsxwriter::Workbook::new();
    let sheet = wb.add_worksheet();

    for (i, name) in cols.iter().enumerate() {
        sheet
            .write_string(0, i as u16, name, None)
            .map_err(|e| e.to_string())?;
    }

    for (r, item) in items.iter().enumerate() {
        let row = (r + 1) as u32;
        for (c, name) in cols.iter().enumerate() {
            match name.as_str() {
                "date" => sheet.write_string(row, c as u16, &item.date, None),
                "account" => sheet.write_string(row, c as u16, &item.account_name, None),
                "category" => sheet.write_string(
                    row,
                    c as u16,
                    &item.category.clone().unwrap_or_default(),
                    None,
                ),
                "description" => sheet.write_string(
                    row,
                    c as u16,
                    &item.description.clone().unwrap_or_default(),
                    None,
                ),
                "amount" => sheet.write_number(row, c as u16, item.amount, None),
                _ => sheet.write_string(row, c as u16, "", None),
            }
            .map_err(|e| e.to_string())?;
        }
    }

    wb.save(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}
