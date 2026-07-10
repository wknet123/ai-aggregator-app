#!/bin/bash
# ============================================
# AI Aggregator Platform - Deployment Script
# ============================================

set -e

echo "============================================"
echo "  AI Aggregator Platform - Deployment"
echo "============================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}Warning: .env file not found. Creating from .env.example...${NC}"
    cp .env.example .env
    echo -e "${YELLOW}Please update .env with your actual configuration values.${NC}"
fi

# Parse command line arguments
COMMAND=${1:-"up"}

case $COMMAND in
    "up")
        echo -e "${GREEN}Starting all services...${NC}"
        docker compose up -d --build
        echo ""
        echo -e "${GREEN}✓ All services started successfully!${NC}"
        echo ""
        echo "Access your application at:"
        echo "  - Frontend: http://localhost:80"
        echo "  - Backend API: http://localhost:8000"
        echo "  - API Docs: http://localhost:8000/docs"
        echo ""
        echo "Default credentials:"
        echo "  - Admin: admin@example.com / 123456"
        echo "  - Demo: demo@example.com / 123456"
        ;;
    
    "down")
        echo -e "${YELLOW}Stopping all services...${NC}"
        docker compose down
        echo -e "${GREEN}✓ All services stopped.${NC}"
        ;;
    
    "restart")
        echo -e "${YELLOW}Restarting all services...${NC}"
        docker compose down
        docker compose up -d --build
        echo -e "${GREEN}✓ All services restarted.${NC}"
        ;;
    
    "logs")
        SERVICE=${2:-""}
        if [ -z "$SERVICE" ]; then
            docker compose logs -f
        else
            docker compose logs -f $SERVICE
        fi
        ;;
    
    "status")
        echo -e "${GREEN}Service Status:${NC}"
        docker compose ps
        ;;
    
    "clean")
        echo -e "${RED}Warning: This will remove all containers, volumes, and images!${NC}"
        read -p "Are you sure? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            docker compose down -v --rmi all
            echo -e "${GREEN}✓ Cleanup complete.${NC}"
        fi
        ;;
    
    "rebuild")
        SERVICE=${2:-""}
        if [ -z "$SERVICE" ]; then
            echo -e "${YELLOW}Rebuilding all services...${NC}"
            docker compose build --no-cache
        else
            echo -e "${YELLOW}Rebuilding $SERVICE...${NC}"
            docker compose build --no-cache $SERVICE
        fi
        docker compose up -d
        echo -e "${GREEN}✓ Rebuild complete.${NC}"
        ;;
    
    "shell")
        SERVICE=${2:-"backend"}
        echo -e "${GREEN}Opening shell in $SERVICE container...${NC}"
        docker compose exec $SERVICE /bin/sh
        ;;
    
    "db")
        echo -e "${GREEN}Connecting to MySQL database...${NC}"
        docker compose exec db sh -lc 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
        ;;
    
    *)
        echo "Usage: ./deploy.sh [command] [options]"
        echo ""
        echo "Commands:"
        echo "  up        - Start all services (default)"
        echo "  down      - Stop all services"
        echo "  restart   - Restart all services"
        echo "  logs      - View logs (optionally specify service)"
        echo "  status    - View service status"
        echo "  clean     - Remove all containers, volumes, and images"
        echo "  rebuild   - Rebuild containers (optionally specify service)"
        echo "  shell     - Open shell in container (default: backend)"
        echo "  db        - Connect to MySQL database"
        echo ""
        echo "Examples:"
        echo "  ./deploy.sh up"
        echo "  ./deploy.sh logs backend"
        echo "  ./deploy.sh rebuild frontend"
        echo "  ./deploy.sh shell backend"
        ;;
esac
