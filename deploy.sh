#!/bin/bash

# Simple deployment script
ssh root@192.3.27.139 "pm2 stop textwall; pm2 delete textwall; rm -rf /var/www/textwall/*"
rsync -avz --exclude node_modules ~/Documents/code/textwall/* root@192.3.27.139:/var/www/textwall
ssh root@192.3.27.139 "cd /var/www/textwall && npm install && pm2 start server.js --name textwall"