#!/usr/bin/env Rscript
# run_app.R — robust launcher for Shiny/golem apps (with safe fallback)

# ---- Prefer portable libs from env (vendored runtime) ----
portable <- unique(c(
  Sys.getenv("R_LIBS_USER", ""),
  Sys.getenv("R_LIBS_SITE", ""),
  Sys.getenv("RENV_PATHS_LIBRARY", "")
))
portable <- portable[nzchar(portable)]
if (length(portable)) .libPaths(unique(c(portable, .libPaths())))

## Require shiny + httpuv
if (!requireNamespace("shiny",   quietly = TRUE))
  stop("Package 'shiny' not installed. libs: ", paste(.libPaths(), collapse = " | "), call. = FALSE)
if (!requireNamespace("httpuv",  quietly = TRUE))
  stop("Package 'httpuv' not installed (required by shiny).", call. = FALSE)

## Parse --host / --port (supports --port 0)
args <- commandArgs(trailingOnly = TRUE)
host <- "127.0.0.1"; port <- 7777L
i <- 1L
while (i <= length(args)) {
  if (identical(args[i], "--host") && i < length(args)) { host <- args[i+1L]; i <- i+2L; next }
  if (identical(args[i], "--port") && i < length(args)) { port <- as.integer(args[i+1L]); i <- i+2L; next }
  i <- i + 1L
}
if (!is.finite(port) || port <= 0L) port <- httpuv::randomPort()

## Find this script dir
args_all   <- commandArgs(trailingOnly = FALSE)
file_arg   <- grep("^--file=", args_all, value = TRUE)
scriptfile <- if (length(file_arg)) sub("^--file=", "", file_arg[1]) else ""
script_dir <- if (nzchar(scriptfile)) dirname(scriptfile) else getwd()
script_dir <- normalizePath(script_dir, winslash = "/", mustWork = FALSE)

## Resolve folder-style app: shiny/ or app.R or ui.R+server.R (no /R package)
pick_app_dir <- function(base) {
  # optional override via APP_SUBDIR
  subdir <- Sys.getenv("APP_SUBDIR","")
  if (nzchar(subdir) && dir.exists(file.path(base, subdir))) return(file.path(base, subdir))

  # 1) Your required layout: shinynew/
  if (dir.exists(file.path(base, "R"))) return(file.path(base, "R"))

  # 2) Fallbacks if you ever switch layouts
  if (file.exists(file.path(base, "app.R"))) return(base)
  if (file.exists(file.path(base, "ui.R")) &&
      file.exists(file.path(base, "server.R")))               return(base)
  NA_character_
}

app_dir <- pick_app_dir(script_dir)

# ---- Start app (or safe fallback) ----
message(sprintf("R: %s", R.version.string))
message(".libPaths(): ", paste(.libPaths(), collapse = " | "))
message("Script dir: ", script_dir)

## Always emit a URL to STDOUT so Electron can catch it
cat(sprintf("Listening on http://%s:%d\n", host, port)); flush.console()
if (!is.na(app_dir)) {
  message("Launching Shiny app from: ", app_dir)
  shiny::runApp(appDir = app_dir, host = host, port = port, launch.browser = FALSE, quiet = TRUE)
} else {
  # Fallback inline app so it never goes silent
  message("No app folder found next to run_app.R (looked for 'R/', 'app.R', or 'ui.R'+'server.R').")
  message("Starting fallback test app at http://", host, ":", port)
  ui <- shiny::fluidPage(
    shiny::titlePanel("Vendored R Test"),
    shiny::tags$hr(),
    shiny::p(sprintf("R: %s", R.version.string)),
    shiny::p(sprintf(".libPaths(): %s", paste(.libPaths(), collapse = " | "))),
    shiny::p(sprintf("Host: %s  |  Port: %s", host, port)),
    shiny::actionButton("ping", "Ping"),
    shiny::verbatimTextOutput("out")
  )
  server <- function(input, output, session) {
    shiny::observeEvent(input$ping, {
      output$out <- shiny::renderPrint({
        list(time = Sys.time(), pid = Sys.getpid(), wd = normalizePath(getwd(), winslash="/"))
      })
    })
  }
  shiny::runApp(list(ui = ui, server = server),
                host = host, port = port, launch.browser = FALSE, quiet = TRUE)
}