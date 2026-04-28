FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Copia todos os assets do frontend (raiz do projeto)
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
