# EOPCRF_SH

Employee's Output-based Performance Commitment and Review Form -- a trimmed,
standalone sibling of the larger SGOD PMES project. This app only covers the
4 EOPCRF parts (formerly IRC8a-8d):

| Navbar label | Internally | Covers |
|---|---|---|
| EOPCRF I   | `irc8a` | Individual Performance Commitment and Review Form (IPCRF) -- KRAs, Objectives, rubric ratings |
| EOPCRF II  | `irc8b` | Core Behavioral Competencies and Core Skills |
| EOPCRF III | `irc8c` | Summary of Ratings for Discussion -- final rating, sign-off, development plans |
| EOPCRF IV  | `irc8d` | Read-only summary, mirrors EOPCRF I live |

There is **no file-upload / PDF-import feature** in this app -- every field
is entered by hand through each tab's own UI.

## Setup

```bash
pip install -r requirements.txt
flask --app app init-db   # creates instance/eopcrf_sh.db
python app.py             # runs the dev server on http://127.0.0.1:5000
```

## Logos

`templates/base.html` and `templates/home.html` reference 4 logo files that
were **not** included in this build (they weren't part of the source
material this app was generated from):

```
static/images/deped.png
static/images/antipolo_division.png
static/images/i_love_sgod.png
static/images/project_irc.png
```

Drop your own copies of these in `static/images/` with those exact
filenames, or edit the `<img>` tags in `templates/base.html` /
`templates/home.html` to point elsewhere.

## Project structure

```
app.py                      Flask app: config, DB setup, all routes
models.py                   SQLAlchemy models (IRC8a-d + shared signatory tables)
requirements.txt
static/
  css/
    base.css                Layout, nav, header, report-signatory footer
    home.css                Home page masthead + report cards
    irc8a.css .. irc8d.css  Per-tab styling
  js/
    index.js                Preparer name/position, IRC8a approving authority, signatory dates
    irc8a.js .. irc8d.js    Per-tab client logic (fetches /irc/<tab>/data, renders, saves)
  images/                   <- put your logo files here (see above)
templates/
  base.html                 Shared shell: header, nav, report-signatory footer
  home.html                 Landing page: EOPCRF group card + 2 "coming soon" placeholders
  _macros.html              Shared signatory_date() Jinja macro
  404.html
  tabs/
    irc8a.html .. irc8d.html
```
