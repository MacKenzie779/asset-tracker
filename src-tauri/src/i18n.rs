//! Report language. Mirrors the UI's `src/locales` for the strings that appear
//! in exported PDF and XLSX files.
//!
//! The frontend passes its active language code with every export command; an
//! unknown or missing code falls back to English, so an older frontend keeps
//! working unchanged.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    En,
    De,
}

impl Default for Lang {
    fn default() -> Self {
        Lang::En
    }
}

impl Lang {
    pub fn from_code(code: Option<&str>) -> Lang {
        match code.map(|c| c.trim().to_ascii_lowercase()) {
            Some(c) if c == "de" || c.starts_with("de-") => Lang::De,
            _ => Lang::En,
        }
    }
}

/// `name => "english", "deutsch";`
macro_rules! strings {
    ($($name:ident => $en:expr, $de:expr;)*) => {
        impl Lang {
            $(
                pub fn $name(self) -> &'static str {
                    match self { Lang::En => $en, Lang::De => $de }
                }
            )*
        }
    };
}

strings! {
    /* document titles */
    title_transactions   => "TRANSACTIONS", "TRANSAKTIONEN";
    title_settlement     => "SETTLEMENT STATEMENT", "ABRECHNUNG";

    /* column headers */
    col_date             => "DATE", "DATUM";
    col_account          => "ACCOUNT", "KONTO";
    col_category         => "CATEGORY", "KATEGORIE";
    col_note             => "NOTE", "NOTIZ";
    col_value            => "VALUE", "BETRAG";
    col_category_note    => "CATEGORY / NOTE", "KATEGORIE / NOTIZ";

    /* headline figures */
    open_amount          => "OPEN AMOUNT", "OFFENER BETRAG";
    net_amount           => "NET", "NETTO";
    by_category          => "BY CATEGORY", "NACH KATEGORIE";

    /* summary rows */
    income               => "INCOME", "EINNAHMEN";
    expenses             => "EXPENSES", "AUSGABEN";
    saldo                => "SALDO", "SALDO";

    /* meta */
    all_accounts         => "All accounts", "Alle Konten";
    all_time             => "All time", "Gesamter Zeitraum";
    uncategorized        => "Uncategorized", "Ohne Kategorie";
    no_items             => "Nothing to show.", "Nichts anzuzeigen.";

    /* xlsx sheet labels (sentence case, they sit in a label column) */
    x_transactions_export => "Transactions export", "Transaktionsexport";
    x_settlement_report   => "Settlement statement", "Abrechnung";
    x_account             => "Account", "Konto";
    x_status              => "Status", "Status";
    x_period              => "Period", "Zeitraum";
    x_time_span           => "Time span", "Zeitraum";
    x_generated           => "Generated", "Erstellt";
    x_date                => "Date", "Datum";
    x_category            => "Category", "Kategorie";
    x_notes               => "Notes", "Notiz";
    x_value               => "Value", "Betrag";
    x_total_income        => "Total income", "Summe Einnahmen";
    x_total_expenses      => "Total expenses", "Summe Ausgaben";
    x_saldo               => "Saldo", "Saldo";
    x_open_amount         => "Open amount", "Offener Betrag";
}

impl Lang {
    /// "GENERATED 13.09.2026 23:29"
    pub fn generated(self, when: &str) -> String {
        match self {
            Lang::En => format!("GENERATED {when}"),
            Lang::De => format!("ERSTELLT {when}"),
        }
    }

    /// "PAGE 1 OF 3"
    pub fn page_of(self, page: usize, total: usize) -> String {
        match self {
            Lang::En => format!("PAGE {page} OF {total}"),
            Lang::De => format!("SEITE {page} VON {total}"),
        }
    }

    /// "TOTAL · 30 ITEMS"
    pub fn total_items(self, n: usize) -> String {
        match (self, n) {
            (Lang::En, 1) => "TOTAL · 1 ITEM".to_string(),
            (Lang::En, n) => format!("TOTAL · {n} ITEMS"),
            (Lang::De, 1) => "SUMME · 1 POSTEN".to_string(),
            (Lang::De, n) => format!("SUMME · {n} POSTEN"),
        }
    }

    /// "Heidi owes you" / "You owe Heidi"
    pub fn direction(self, name: &str, they_owe: bool) -> String {
        match (self, they_owe) {
            (Lang::En, true) => format!("{name} owes you"),
            (Lang::En, false) => format!("You owe {name}"),
            (Lang::De, true) => format!("{name} schuldet dir"),
            (Lang::De, false) => format!("Du schuldest {name}"),
        }
    }

    pub fn from_date(self, d: &str) -> String {
        match self {
            Lang::En => format!("from {d}"),
            Lang::De => format!("ab {d}"),
        }
    }

    pub fn until_date(self, d: &str) -> String {
        match self {
            Lang::En => format!("until {d}"),
            Lang::De => format!("bis {d}"),
        }
    }

    /// Appended to a note when only part of an open item is settled.
    pub fn partial(self, part: &str, whole: &str) -> String {
        match self {
            Lang::En => format!("(partial: {part} € of {whole} €)"),
            Lang::De => format!("(teilweise: {part} € von {whole} €)"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_code_parsing_falls_back_to_english() {
        assert_eq!(Lang::from_code(Some("de")), Lang::De);
        assert_eq!(Lang::from_code(Some("DE")), Lang::De);
        assert_eq!(Lang::from_code(Some("de-DE")), Lang::De);
        assert_eq!(Lang::from_code(Some("en")), Lang::En);
        assert_eq!(Lang::from_code(Some("fr")), Lang::En);
        assert_eq!(Lang::from_code(None), Lang::En);
    }

    #[test]
    fn counted_strings_use_the_singular_form() {
        assert_eq!(Lang::En.total_items(1), "TOTAL · 1 ITEM");
        assert_eq!(Lang::En.total_items(30), "TOTAL · 30 ITEMS");
        assert_eq!(Lang::De.total_items(1), "SUMME · 1 POSTEN");
    }

    #[test]
    fn direction_reads_naturally_in_both_languages() {
        assert_eq!(Lang::En.direction("Heidi", true), "Heidi owes you");
        assert_eq!(Lang::En.direction("Heidi", false), "You owe Heidi");
        assert_eq!(Lang::De.direction("Heidi", true), "Heidi schuldet dir");
        assert_eq!(Lang::De.direction("Heidi", false), "Du schuldest Heidi");
    }
}
