#!/usr/bin/env Rscript

# Parse args from Electron
args <- commandArgs(trailingOnly = TRUE)
get_arg <- function(flag, default = NULL) {
  i <- which(args == flag)
  if (length(i) == 0 || i == length(args)) return(default)
  args[i + 1]
}

port <- as.integer(get_arg("--port", "7777"))   # fixed default; you can change
host <- get_arg("--host", "127.0.0.1")

# Make Shiny/Golem honor host/port even if run_app() doesn't take them
options(shiny.launch.browser = FALSE)
options(shiny.port = port)
options(shiny.host = host)

# Production flag (as in your app.R)
options("golem.app.prod" = TRUE)

# Start your app
suppressPackageStartupMessages({
  library(idepGolem)  # <-- your package
})
idepGolem::run_app()

# (Shiny blocks here; nothing else needed)
