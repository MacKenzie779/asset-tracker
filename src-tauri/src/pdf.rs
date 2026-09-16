//! The look of the exported PDFs: a quiet, monospaced statement on warm paper.
//!
//! Everything is set in DejaVu Sans Mono, which is embedded in the binary via
//! `include_bytes!` so a packaged build carries its own fonts. Because the face
//! is a true monospace (every glyph advances 0.60205 em) text measurement here
//! is exact rather than estimated, which is what lets columns, right-aligned
//! amounts and truncation land precisely.
//!
//! Layout is a single content band split into a wide table and a narrow
//! sidebar:
//!
//! ```text
//!   TITLE                                        LABEL
//!   subtitle                                   1.234,56 €
//!   ────────────────────────────────────────────────────
//!   DATE  CATEGORY / NOTE      VALUE   │  BY CATEGORY
//!   ...rows...                         │  ...bars...
//!   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
//!   TOTAL · n ITEMS           1.234,56 │
//!   GENERATED ...                        PAGE 1 OF 1
//! ```

use printpdf::{
    Color, IndirectFontRef, Line, Mm, PdfDocument, PdfDocumentReference, PdfLayerReference, Point,
    Rgb,
};

use crate::i18n::Lang;

/* ---------------------------------------------------------------- fonts -- */

const FONT_REGULAR: &[u8] = include_bytes!("../assets/DejaVuSansMono.ttf");
const FONT_BOLD: &[u8] = include_bytes!("../assets/DejaVuSansMono-Bold.ttf");

/// Advance width of every glyph in DejaVu Sans Mono, in em (1233/2048).
const MONO_ADVANCE_EM: f64 = 0.60205;
const PT_PER_MM: f64 = 72.0 / 25.4;

/// Exact width of `s` in mm at `fs` points, including letter tracking.
pub fn text_w(s: &str, fs: f64, tracking_pt: f64) -> f64 {
    let n = s.chars().count() as f64;
    (n * MONO_ADVANCE_EM * fs + n * tracking_pt) / PT_PER_MM
}

/// Largest prefix of `s` that fits `max_mm`, with an ellipsis when it is cut.
pub fn clip(s: &str, max_mm: f64, fs: f64) -> String {
    if text_w(s, fs, 0.0) <= max_mm {
        return s.to_string();
    }
    let per_char = text_w("M", fs, 0.0);
    let budget = (max_mm / per_char).floor() as usize;
    if budget <= 1 {
        return "…".to_string();
    }
    s.chars().take(budget - 1).collect::<String>() + "…"
}

/* --------------------------------------------------------------- colours -- */

fn rgb(hex: u32) -> Color {
    let r = ((hex >> 16) & 0xFF) as f64 / 255.0;
    let g = ((hex >> 8) & 0xFF) as f64 / 255.0;
    let b = (hex & 0xFF) as f64 / 255.0;
    Color::Rgb(Rgb::new(r, g, b, None))
}

/// Warm paper the whole page is painted with.
pub fn paper() -> Color {
    rgb(0xFA_F9_F5)
}
/// Sidebar panel, a shade deeper than the paper.
pub fn panel() -> Color {
    rgb(0xF2_F1_E9)
}
/// Primary text.
pub fn ink() -> Color {
    rgb(0x1C_1C_18)
}
/// Secondary text: category names, subtitles.
pub fn ink_2() -> Color {
    rgb(0x6E_6E_63)
}
/// Meta text: notes, column headers, footer.
pub fn ink_3() -> Color {
    rgb(0x9C_9C_8F)
}
/// Hairlines between rows.
pub fn rule() -> Color {
    rgb(0xE2_E0_D6)
}
/// Track behind a share bar.
pub fn bar_track() -> Color {
    rgb(0xE2_E0_D6)
}
/// Share bar fill: muted olive, in key with the paper.
pub fn bar_fill() -> Color {
    rgb(0x7E_84_66)
}
/// Positive amounts, used only where signs are mixed.
pub fn pos() -> Color {
    rgb(0x5E_7A_52)
}
/// Negative amounts, used only where signs are mixed.
pub fn neg() -> Color {
    rgb(0xA6_5A_4A)
}

/* ---------------------------------------------------------------- metrics */

pub const PAGE_W: f64 = 210.0;
pub const PAGE_H: f64 = 297.0;
pub const MARGIN_X: f64 = 16.0;
pub const MARGIN_TOP: f64 = 16.0;
pub const MARGIN_BOT: f64 = 14.0;

pub const CONTENT_W: f64 = PAGE_W - 2.0 * MARGIN_X; // 178
pub const TABLE_W: f64 = 114.0;
pub const GUTTER: f64 = 8.0;
pub const SIDE_W: f64 = CONTENT_W - TABLE_W - GUTTER; // 56
pub const SIDE_X: f64 = MARGIN_X + TABLE_W + GUTTER;

pub const COL_DATE_W: f64 = 22.0;
pub const COL_VALUE_W: f64 = 26.0;

/* type sizes (pt) */
pub const FS_TITLE: f64 = 8.6;
pub const FS_BIG: f64 = 19.0;
pub const FS_SUB: f64 = 7.4;
pub const FS_LABEL: f64 = 6.4;
pub const FS_ROW: f64 = 8.2;
pub const FS_FOOT: f64 = 6.6;

/* tracking (pt) applied to the uppercase labels */
pub const TRACK_TITLE: f64 = 1.5;
pub const TRACK_LABEL: f64 = 0.9;

pub const ROW_H: f64 = 6.4;

/* ------------------------------------------------------------------- page */

/// A page under construction. `y` is the running baseline, in mm from the
/// bottom of the page, and always points at the next line to be drawn.
pub struct Sheet {
    pub layer: PdfLayerReference,
    pub y: f64,
}

pub struct Report {
    pub doc: PdfDocumentReference,
    pub font: IndirectFontRef,
    pub bold: IndirectFontRef,
    pub lang: Lang,
    sheets: Vec<PdfLayerReference>,
}

impl Report {
    pub fn new(title: &str, lang: Lang) -> Result<(Report, Sheet), String> {
        let (doc, page, layer) = PdfDocument::new(title, Mm(PAGE_W), Mm(PAGE_H), "page");
        let font = doc
            .add_external_font(std::io::Cursor::new(FONT_REGULAR))
            .map_err(|e| e.to_string())?;
        let bold = doc
            .add_external_font(std::io::Cursor::new(FONT_BOLD))
            .map_err(|e| e.to_string())?;
        let layer_ref = doc.get_page(page).get_layer(layer);
        paint_paper(&layer_ref);
        let sheet = Sheet {
            layer: layer_ref.clone(),
            y: PAGE_H - MARGIN_TOP,
        };
        Ok((
            Report {
                doc,
                font,
                bold,
                lang,
                sheets: vec![layer_ref],
            },
            sheet,
        ))
    }

    /// Start a new page and reset the cursor to just under the top margin.
    pub fn new_page(&mut self, sheet: &mut Sheet) {
        let (page, layer) = self.doc.add_page(Mm(PAGE_W), Mm(PAGE_H), "page");
        let layer_ref = self.doc.get_page(page).get_layer(layer);
        paint_paper(&layer_ref);
        self.sheets.push(layer_ref.clone());
        sheet.layer = layer_ref;
        sheet.y = PAGE_H - MARGIN_TOP;
    }

    /// Footers carry "PAGE n OF m", so they are painted once the page count is
    /// final — after every row has been laid out.
    pub fn draw_footers(&self, generated: &str) {
        let total = self.sheets.len();
        for (i, layer) in self.sheets.iter().enumerate() {
            let y = MARGIN_BOT;
            text(layer, &self.font, generated, MARGIN_X, y, FS_FOOT, ink_3(), TRACK_LABEL);
            let right = self.lang.page_of(i + 1, total);
            let w = text_w(&right, FS_FOOT, TRACK_LABEL);
            text(
                layer,
                &self.font,
                &right,
                MARGIN_X + CONTENT_W - w,
                y,
                FS_FOOT,
                ink_3(),
                TRACK_LABEL,
            );
        }
    }

    pub fn save(self, path: &std::path::Path) -> Result<(), String> {
        let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
        self.doc
            .save(&mut std::io::BufWriter::new(file))
            .map_err(|e| e.to_string())
    }
}

fn paint_paper(layer: &PdfLayerReference) {
    fill_rect(layer, 0.0, PAGE_H, PAGE_W, PAGE_H, paper());
}

/* --------------------------------------------------------------- drawing -- */

/// Filled rectangle. `y_top` is the upper edge; the box grows downwards.
pub fn fill_rect(layer: &PdfLayerReference, x: f64, y_top: f64, w: f64, h: f64, color: Color) {
    let pts = vec![
        (Point::new(Mm(x), Mm(y_top)), false),
        (Point::new(Mm(x + w), Mm(y_top)), false),
        (Point::new(Mm(x + w), Mm(y_top - h)), false),
        (Point::new(Mm(x), Mm(y_top - h)), false),
    ];
    layer.set_fill_color(color);
    layer.add_shape(Line {
        points: pts,
        is_closed: true,
        has_fill: true,
        has_stroke: false,
        is_clipping_path: false,
    });
}

/// Horizontal rule of the given thickness, drawn as a thin filled box so the
/// weight is exact rather than dependent on stroke rounding.
pub fn hrule(layer: &PdfLayerReference, x: f64, y: f64, w: f64, thickness: f64, color: Color) {
    fill_rect(layer, x, y, w, thickness, color);
}

/// Text on its baseline at (`x`, `y`), optionally letter-tracked.
pub fn text(
    layer: &PdfLayerReference,
    font: &IndirectFontRef,
    s: &str,
    x: f64,
    y: f64,
    fs: f64,
    color: Color,
    tracking_pt: f64,
) {
    if s.is_empty() {
        return;
    }
    layer.begin_text_section();
    layer.set_fill_color(color);
    layer.set_font(font, fs);
    // Always set tracking, including 0: it is graphics state and would
    // otherwise leak from a previous tracked run into this one.
    layer.set_character_spacing(tracking_pt);
    layer.set_text_cursor(Mm(x), Mm(y));
    layer.write_text(s, font);
    layer.end_text_section();
}

/// Text whose right edge sits at `right_x`.
pub fn text_right(
    layer: &PdfLayerReference,
    font: &IndirectFontRef,
    s: &str,
    right_x: f64,
    y: f64,
    fs: f64,
    color: Color,
    tracking_pt: f64,
) {
    let w = text_w(s, fs, tracking_pt);
    text(layer, font, s, right_x - w, y, fs, color, tracking_pt);
}

/* ------------------------------------------------------------ formatting -- */

/// "YYYY-MM-DD" -> "DD.MM.YYYY". Both languages use the same date shape, as
/// the UI does.
pub fn iso_to_de(iso: &str) -> String {
    if iso.len() >= 10 && iso.is_char_boundary(10) {
        format!("{}.{}.{}", &iso[8..10], &iso[5..7], &iso[0..4])
    } else {
        iso.to_string()
    }
}

/// "1.234,56", signed. Grouping and decimal comma match the UI everywhere.
pub fn amount(v: f64) -> String {
    let sign = if v < 0.0 { "-" } else { "" };
    let rounded = (v.abs() * 100.0).round() / 100.0;
    let s = format!("{rounded:.2}");
    let (int_part, frac) = s.split_once('.').unwrap_or((s.as_str(), "00"));
    let mut grouped = String::new();
    for (i, ch) in int_part.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(ch);
    }
    let int_grouped: String = grouped.chars().rev().collect();
    format!("{sign}{int_grouped},{frac}")
}

/// "1.234,56 €"
pub fn amount_eur(v: f64) -> String {
    format!("{} €", amount(v))
}


/* ------------------------------------------------------- composed blocks -- */

/// The masthead: title and subtitle on the left, a headline figure on the
/// right, closed by a hairline.
pub struct Header<'a> {
    pub title: &'a str,
    pub subtitle: &'a str,
    pub figure_label: &'a str,
    pub figure: &'a str,
    pub note: &'a str,
}

pub fn draw_header(r: &Report, sheet: &mut Sheet, h: &Header) {
    let right = MARGIN_X + CONTENT_W;
    let mut y = sheet.y - 4.0;

    text(&sheet.layer, &r.bold, h.title, MARGIN_X, y, FS_TITLE, ink(), TRACK_TITLE);
    text_right(&sheet.layer, &r.font, h.figure_label, right, y, FS_LABEL, ink_3(), TRACK_LABEL);

    // The figure is the one large element on the page; it hangs below its label.
    y -= 9.0;
    text_right(&sheet.layer, &r.font, h.figure, right, y, FS_BIG, ink(), 0.0);

    // Subtitle sits on the baseline of the figure's lower edge.
    text(&sheet.layer, &r.font, h.subtitle, MARGIN_X, sheet.y - 11.0, FS_SUB, ink_3(), TRACK_LABEL);

    y -= 5.5;
    text_right(&sheet.layer, &r.font, h.note, right, y, FS_SUB, ink_3(), 0.0);

    y -= 7.0;
    hrule(&sheet.layer, MARGIN_X, y, CONTENT_W, 0.25, rule());
    sheet.y = y - 7.0;
}

/// One table column. `right` right-aligns the cell against the column's right
/// edge, which is what amounts want.
pub struct Col {
    pub key: String,
    pub label: String,
    pub w: f64,
    pub right: bool,
}

/// What goes in a cell. `Pair` is the mockup's "category then note" treatment:
/// two tones on one line, the note taking whatever width is left.
pub enum Cell {
    Plain(String),
    Pair(String, String),
    Amount(f64, bool),
}

pub fn draw_table_head(r: &Report, sheet: &mut Sheet, cols: &[Col]) {
    let y = sheet.y;
    let mut x = MARGIN_X;
    for c in cols {
        if c.right {
            text_right(&sheet.layer, &r.font, &c.label, x + c.w, y, FS_LABEL, ink_3(), TRACK_LABEL);
        } else {
            text(&sheet.layer, &r.font, &c.label, x, y, FS_LABEL, ink_3(), TRACK_LABEL);
        }
        x += c.w;
    }
    let ry = y - 3.0;
    hrule(&sheet.layer, MARGIN_X, ry, TABLE_W, 0.25, rule());
    sheet.y = ry - 5.2;
}

pub fn draw_row(r: &Report, sheet: &mut Sheet, cols: &[Col], cells: &[Cell]) {
    let y = sheet.y;
    let mut x = MARGIN_X;
    for (i, c) in cols.iter().enumerate() {
        // A little breathing room between columns so glyphs never touch.
        let inner = c.w - 2.0;
        match cells.get(i) {
            Some(Cell::Plain(s)) => {
                let s = clip(s, inner, FS_ROW);
                if c.right {
                    text_right(&sheet.layer, &r.font, &s, x + c.w, y, FS_ROW, ink(), 0.0);
                } else {
                    text(&sheet.layer, &r.font, &s, x, y, FS_ROW, ink_2(), 0.0);
                }
            }
            Some(Cell::Pair(head, tail)) => {
                let head_s = clip(head, inner, FS_ROW);
                text(&sheet.layer, &r.font, &head_s, x, y, FS_ROW, ink(), 0.0);
                if !tail.is_empty() {
                    let used = text_w(&head_s, FS_ROW, 0.0) + text_w(" ", FS_ROW, 0.0);
                    let left = inner - used;
                    if left > text_w("mm", FS_ROW, 0.0) {
                        let tail_s = clip(tail, left, FS_ROW);
                        text(&sheet.layer, &r.font, &tail_s, x + used, y, FS_ROW, ink_3(), 0.0);
                    }
                }
            }
            Some(Cell::Amount(v, tint)) => {
                let s = clip(&amount(*v), inner, FS_ROW);
                let color = if !*tint {
                    ink()
                } else if *v < 0.0 {
                    neg()
                } else {
                    pos()
                };
                text_right(&sheet.layer, &r.font, &s, x + c.w, y, FS_ROW, color, 0.0);
            }
            None => {}
        }
        x += c.w;
    }
    sheet.y = y - ROW_H;
}

/// The closing band: a heavy rule, then the item count against the total.
pub fn draw_total(r: &Report, sheet: &mut Sheet, label: &str, value: &str) {
    let y = sheet.y - 1.5;
    hrule(&sheet.layer, MARGIN_X, y, TABLE_W, 0.7, ink());
    let by = y - 6.0;
    text(&sheet.layer, &r.font, label, MARGIN_X, by, FS_LABEL, ink(), TRACK_LABEL);
    text_right(&sheet.layer, &r.bold, value, MARGIN_X + TABLE_W, by, FS_ROW, ink(), 0.0);
    sheet.y = by - 6.0;
}

/// A line in the sidebar: one category's total, how often it occurred, and its
/// share of the whole drawn as a bar.
pub struct Stat {
    pub name: String,
    pub total: f64,
    pub count: usize,
    pub share: f64,
}

/// The sidebar panel. It is a fixed block anchored to the top of the content
/// band rather than part of the row flow, so it only appears on page one.
pub fn draw_sidebar(r: &Report, layer: &PdfLayerReference, y_top: f64, stats: &[Stat]) {
    if stats.is_empty() {
        return;
    }
    let rows = stats.len().min(8);
    let row_h = 15.5;
    let pad = 6.0;
    let h = pad * 2.0 + 8.0 + rows as f64 * row_h;

    fill_rect(layer, SIDE_X, y_top, SIDE_W, h, panel());

    let x = SIDE_X + pad;
    let inner = SIDE_W - pad * 2.0;
    let mut y = y_top - pad - 4.0;
    text(layer, &r.font, r.lang.by_category(), x, y, FS_LABEL, ink_3(), TRACK_LABEL);
    y -= 10.0;

    for st in stats.iter().take(rows) {
        let value = amount(st.total);
        let value_w = text_w(&value, FS_ROW, 0.0);
        let name = clip(&st.name, inner - value_w - 2.0, FS_ROW);
        text(layer, &r.font, &name, x, y, FS_ROW, ink(), 0.0);
        text_right(layer, &r.font, &value, x + inner, y, FS_ROW, ink(), 0.0);

        let meta_y = y - 4.2;
        text(layer, &r.font, &format!("{}×", st.count), x, meta_y, FS_LABEL, ink_3(), 0.0);
        let pct = format!("{}%", (st.share * 100.0).round() as i64);
        text_right(layer, &r.font, &pct, x + inner, meta_y, FS_LABEL, ink_3(), 0.0);

        // Share bar: a full-width track with the category's slice filled in.
        let bar_y = meta_y - 2.6;
        hrule(layer, x, bar_y, inner, 1.1, bar_track());
        let fill_w = (inner * st.share.clamp(0.0, 1.0)).max(0.6);
        hrule(layer, x, bar_y, fill_w, 1.1, bar_fill());

        y -= row_h;
    }
}

/// Group rows into sidebar stats, biggest first. `value_of` returns the
/// magnitude that should count towards the share.
pub fn stats_from<T>(
    rows: &[T],
    lang: Lang,
    category_of: impl Fn(&T) -> Option<String>,
    value_of: impl Fn(&T) -> f64,
) -> Vec<Stat> {
    use std::collections::HashMap;
    let mut by: HashMap<String, (f64, usize)> = HashMap::new();
    for row in rows {
        let v = value_of(row).abs();
        if v <= 0.0049 {
            continue;
        }
        let name = category_of(row)
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| lang.uncategorized().to_string());
        let e = by.entry(name).or_insert((0.0, 0));
        e.0 += v;
        e.1 += 1;
    }
    let total: f64 = by.values().map(|(v, _)| *v).sum();
    let mut out: Vec<Stat> = by
        .into_iter()
        .map(|(name, (v, count))| Stat {
            name,
            total: v,
            count,
            share: if total > 0.0 { v / total } else { 0.0 },
        })
        .collect();
    out.sort_by(|a, b| {
        b.total
            .partial_cmp(&a.total)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.name.cmp(&b.name))
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amounts_group_thousands_and_use_a_decimal_comma() {
        assert_eq!(amount(0.0), "0,00");
        assert_eq!(amount(5.5), "5,50");
        assert_eq!(amount(1234.56), "1.234,56");
        assert_eq!(amount(-1234.56), "-1.234,56");
        assert_eq!(amount(1234567.0), "1.234.567,00");
        assert_eq!(amount(-0.005), "-0,01");
    }

    #[test]
    fn iso_dates_become_german_dates() {
        assert_eq!(iso_to_de("2026-09-13"), "13.09.2026");
        assert_eq!(iso_to_de("2026-09-13T10:00"), "13.09.2026");
        assert_eq!(iso_to_de("nonsense"), "nonsense");
    }

    #[test]
    fn monospace_width_is_linear_in_character_count() {
        let one = text_w("M", 10.0, 0.0);
        let ten = text_w("MMMMMMMMMM", 10.0, 0.0);
        assert!((ten - one * 10.0).abs() < 1e-9);
        // tracking adds exactly one unit per character
        let tracked = text_w("MM", 10.0, 1.0);
        assert!((tracked - (text_w("MM", 10.0, 0.0) + 2.0 / PT_PER_MM)).abs() < 1e-9);
    }

    /// Composes a full statement through the real layout path and writes it to
    /// `PDF_SAMPLE_OUT` when that is set, so the design can be eyeballed:
    ///
    /// ```text
    /// PDF_SAMPLE_OUT=/tmp/s.pdf PDF_SAMPLE_LANG=de PDF_SAMPLE_REPEAT=3 \
    ///     cargo test renders_a_sample_statement
    /// ```
    ///
    /// Unset, it still runs end to end as a smoke test that the whole pipeline
    /// produces a saveable document.
    #[test]
    fn renders_a_sample_statement() {
        // PDF_SAMPLE_LANG picks the language; PDF_SAMPLE_REPEAT the row count.
        let lang = Lang::from_code(std::env::var("PDF_SAMPLE_LANG").ok().as_deref());
        let (mut report, mut sheet) = Report::new("Sample", lang).expect("report");

        let figure = amount_eur(471.34);
        draw_header(
            &report,
            &mut sheet,
            &Header {
                title: lang.title_settlement(),
                subtitle: "HEIDI · 01.09.2026 – 13.09.2026",
                figure_label: lang.open_amount(),
                figure: &figure,
                note: &lang.direction("Heidi", true),
            },
        );

        // PDF_SAMPLE_REPEAT multiplies the rows to exercise pagination.
        let repeat: usize = std::env::var("PDF_SAMPLE_REPEAT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1);
        let base: Vec<(&str, &str, &str, f64)> = vec![
            ("2026-09-01", "Abo", "Netflix", 12.99),
            ("2026-09-01", "Lebensmittel", "rewe", 24.10),
            ("2026-09-02", "Mobilität", "BVG", 3.20),
            ("2026-09-02", "Restaurant", "Mittag", 11.50),
            ("2026-09-03", "Lebensmittel", "aldi", 18.74),
            ("2026-09-03", "Haushalt", "dm", 7.95),
            ("2026-09-04", "Mobilität", "Flixbus", 22.40),
            ("2026-09-04", "Freizeit", "Kino", 13.00),
            ("2026-09-05", "Abo", "Spotify", 6.49),
            ("2026-09-05", "Mobilität", "Flixbus", 18.98),
            ("2026-09-06", "Lebensmittel", "edeka", 31.22),
            ("2026-09-06", "Restaurant", "Abendessen", 28.60),
            ("2026-09-07", "Haushalt", "Ikea", 44.99),
            ("2026-09-07", "Mobilität", "BVG", 3.20),
            ("2026-09-08", "Lebensmittel", "aldi", 12.05),
            ("2026-09-08", "Freizeit", "Schwimmbad", 6.50),
            ("2026-09-09", "Abo", "iCloud", 2.99),
            ("2026-09-09", "Lebensmittel", "rewe", 16.48),
            ("2026-09-10", "Mobilität", "Taxi", 19.80),
            ("2026-09-10", "Restaurant", "Kaffee", 4.20),
            ("2026-09-10", "Haushalt", "Rossmann", 9.35),
            ("2026-09-11", "Lebensmittel", "edeka", 21.90),
            ("2026-09-11", "Freizeit", "Konzert", 35.00),
            ("2026-09-12", "Lebensmittel", "aldi", 15.68),
            ("2026-09-12", "Lebensmittel", "edeka", 8.85),
            ("2026-09-12", "Mobilität", "BVG", 3.20),
            ("2026-09-13", "Mobilität", "flixbus", 18.53),
            ("2026-09-13", "Restaurant", "Brunch", 17.40),
            ("2026-09-13", "Haushalt", "Baumarkt", 26.15),
            ("2026-09-13", "Abo", "Zeitung", 5.90),
        ];
        let rows: Vec<(&str, &str, &str, f64)> = base
            .iter()
            .cycle()
            .take(base.len() * repeat)
            .cloned()
            .collect();

        let stats = stats_from(&rows, lang, |r| Some(r.1.to_string()), |r| r.3);
        draw_sidebar(&report, &sheet.layer, sheet.y + 4.0, &stats);

        let cols = vec![
            Col { key: "date".into(), label: lang.col_date().into(), w: COL_DATE_W, right: false },
            Col {
                key: "category_note".into(),
                label: lang.col_category_note().into(),
                w: TABLE_W - COL_DATE_W - COL_VALUE_W,
                right: false,
            },
            Col { key: "amount".into(), label: lang.col_value().into(), w: COL_VALUE_W, right: true },
        ];
        draw_table_head(&report, &mut sheet, &cols);

        let floor = MARGIN_BOT + 20.0;
        for (date, cat, note, value) in &rows {
            if sheet.y < floor {
                report.new_page(&mut sheet);
                draw_table_head(&report, &mut sheet, &cols);
            }
            let cells = vec![
                Cell::Plain(iso_to_de(date)),
                Cell::Pair(cat.to_string(), note.to_string()),
                Cell::Amount(*value, false),
            ];
            draw_row(&report, &mut sheet, &cols, &cells);
        }

        let total: f64 = rows.iter().map(|r| r.3).sum();
        draw_total(&report, &mut sheet, &lang.total_items(rows.len()), &amount_eur(total));
        report.draw_footers(&lang.generated("13.09.2026 23:29"));

        // Defaults into target/, which git ignores, so a plain `cargo test`
        // leaves no artefact behind in the tree.
        let out = std::env::var("PDF_SAMPLE_OUT")
            .unwrap_or_else(|_| format!("{}/target/sample_report.pdf", env!("CARGO_MANIFEST_DIR")));
        report.save(std::path::Path::new(&out)).expect("save");
        assert!(std::fs::metadata(&out).expect("written").len() > 1000);
    }

    #[test]
    fn clipping_respects_the_width_budget() {
        let w = text_w("abcdefghij", 8.0, 0.0);
        let out = clip("abcdefghijklmnop", w, 8.0);
        assert!(out.ends_with('…'));
        assert!(text_w(&out, 8.0, 0.0) <= w + 1e-9);
        // a string that already fits is returned untouched
        assert_eq!(clip("abc", w, 8.0), "abc");
    }
}
