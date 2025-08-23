#!/usr/bin/env Rscript

# ------- Prefer vendored site-library (optional but recommended) -------
suppressWarnings({
  this_file <- sub("^--file=", "", grep("^--file=", commandArgs(), value = TRUE))
  script_dir <- if (length(this_file)) dirname(normalizePath(this_file)) else getwd()
  resources_dir <- normalizePath(file.path(script_dir, "..", "..", "resources"), mustWork = FALSE)
  site_lib <- file.path(resources_dir, "R.site-library")
  if (dir.exists(site_lib)) .libPaths(c(site_lib, .libPaths()))
  options(repos = c(CRAN = "https://cloud.r-project.org"))
})

# ---- parse args ----
args <- commandArgs(trailingOnly = TRUE)
get_arg <- function(flag, default = NULL) {
  i <- which(args == flag)
  if (length(i) == 0 || i == length(args)) return(default)
  args[i + 1]
}
port <- as.integer(get_arg("--port", "7777"))
host <- get_arg("--host", "127.0.0.1")

# ---- ensure working directory == repo root (so app.R finds its data/assets) ----
# script_dir = electron/app ; repo_root is two levels up
repo_root <- normalizePath(file.path(script_dir, "..", ".."))
setwd(repo_root)

# ---- force Shiny to use host/port & add debug ----
options(shiny.launch.browser = FALSE, shiny.port = port, shiny.host = host)
options("golem.app.prod" = TRUE, shiny.fullstacktrace = TRUE)

cat("[run_app.R] getwd(): ", getwd(), "\n", sep = "")
cat("[run_app.R] .libPaths():\n"); print(.libPaths()); flush.console()

# ---- load req pkgs with explicit messages (fail fast) ----
for (p in c("shiny","httpuv","idepGolem")) {
  cat("[run_app.R] loading ", p, " ... ", sep = ""); flush.console()
  tryCatch({
    library(p, character.only = TRUE)
    cat("ok\n")
  }, error = function(e) {
    cat("FAIL\n"); message(e); quit(status = 1)
  })
}

cat("[run_app.R] starting idepGolem::run_app() ...\n"); flush.console()
idepGolem::run_app()
# Shiny will print: "Listening on http://127.0.0.1:<port>"
