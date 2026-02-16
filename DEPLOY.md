# CRM Deployment Guide

## Option A: Docker Compose (recommended)

### Prerequisites
- Docker & Docker Compose installed
- Domain pointing to server IP

### Steps

1. **Clone & configure**
```bash
git clone <repo-url> /opt/crm && cd /opt/crm
cp backend/.env.example backend/.env
# Edit backend/.env: set DATABASE_URL, JWT secrets, CORS_ORIGIN
```

2. **Create `.env` for Docker Compose** (at project root)
```bash
cat > .env <<EOF
DB_USER=crm_user
DB_PASSWORD=$(openssl rand -hex 16)
DB_NAME=crm_db
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
CORS_ORIGIN=https://your-domain.com
EOF
```

3. **Update nginx config**
```bash
sed -i 's/server_name localhost/server_name your-domain.com/' nginx/default.conf
```

4. **Build & start**
```bash
docker compose up -d --build
```

5. **Run migrations & seed**
```bash
docker compose exec backend npx prisma db push
docker compose exec backend npx ts-node src/seed.ts
```

6. **Enable HTTPS (certbot)**
```bash
# First-time certificate:
docker run --rm -v certbot-webroot:/var/www/certbot -v certbot-certs:/etc/letsencrypt \
  certbot/certbot certonly --webroot -w /var/www/certbot -d your-domain.com

# Then in nginx/default.conf:
# - Uncomment SSL lines (listen 443, ssl_certificate, ssl_certificate_key)
# - Uncomment HTTP->HTTPS redirect server block
# - Replace YOUR_DOMAIN with your domain

# Uncomment certbot service in docker-compose.yml for auto-renewal
docker compose restart nginx
```

7. **Verify**
```bash
curl https://your-domain.com/api/health
# Expected: {"status":"ok","db":true,"timestamp":"..."}
```

---

## Option B: Manual (nginx + pm2 + PostgreSQL)

### 1. PostgreSQL

```bash
sudo apt update && sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql <<SQL
CREATE USER crm_user WITH PASSWORD 'CHANGE_ME';
CREATE DATABASE crm_db OWNER crm_user;
GRANT ALL PRIVILEGES ON DATABASE crm_db TO crm_user;
SQL
```

### 2. Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### 3. Backend

```bash
cd /opt/crm/backend
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT secrets, CORS_ORIGIN, NODE_ENV=production

npm ci
npx prisma generate
npx prisma db push
npm run build

# Create uploads directory
mkdir -p uploads

# Seed (first deploy only)
npx ts-node src/seed.ts

# Start with pm2
pm2 start dist/server.js --name crm-backend
pm2 save
pm2 startup
```

### 4. Frontend

```bash
cd /opt/crm/frontend
cp .env.example .env
# VITE_API_URL=/api (already set in example)

npm ci
npm run build
# Output in dist/
```

### 5. Nginx

```bash
sudo apt install -y nginx
```

Create `/etc/nginx/sites-available/crm`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 10m;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_read_timeout 60s;
    }

    # Frontend SPA
    location / {
        root /opt/crm/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/crm /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 6. SSL via Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
# Certbot auto-configures nginx for HTTPS + auto-renewal via systemd timer
```

### 7. Verify

```bash
curl https://your-domain.com/api/health
```

---

## Updating

### Docker
```bash
cd /opt/crm
git pull
docker compose up -d --build
docker compose exec backend npx prisma db push
```

### Manual
```bash
cd /opt/crm
git pull

cd backend && npm ci && npm run build && npx prisma db push
pm2 restart crm-backend

cd ../frontend && npm ci && npm run build
```

---

## Default Admin Credentials

After seeding:
- **Login:** `admin`
- **Password:** `admin123`

Change immediately after first login.
