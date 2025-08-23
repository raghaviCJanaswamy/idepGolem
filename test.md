<!-- install.packages("devtools")
devtools::install_github("https://github.com/gexijin/idepGolem", upgrade = "never") -->

# LOCAL
install.packages("devtools")
devtools::install_local("/Users/ragavahini/workspace-sdsu/starter/idepGolem", dependencies = TRUE, upgrade = "never")
idepGolem::run_app()
 
## Testing before packaging

cd electron

## install all packages
### This installs electron, electron-builder, cross-spawn, and wait-on

npm run start


### Trouble shooting - 

### Test before Packaging

cd electron
Rscript app/run_app.R --port 7777 --host 127.0.0.1

## Dev Testing
npm run start

### Packaging


npm run prod-build
(npm run fix-rframework && npm run build)

lsof -i -P | grep 7777
