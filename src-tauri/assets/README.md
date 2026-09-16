# Bundled fonts

`DejaVuSansMono.ttf` and `DejaVuSansMono-Bold.ttf` are embedded into the binary
by `src/pdf.rs` (`include_bytes!`) and are the only faces the exported PDFs use.

They are embedded rather than read from disk at runtime so a packaged build
carries its own fonts on every platform.

DejaVu is a true monospace (every glyph advances 0.60205 em), which is what lets
`pdf::text_w` measure text exactly instead of estimating.

Licence: see `DejaVu-LICENSE.txt` (Bitstream Vera / Arev, permissive).
