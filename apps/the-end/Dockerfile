# 停機後的結束頁：只有一個靜態頁面，不連資料庫
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 8080
