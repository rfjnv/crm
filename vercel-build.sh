#!/bin/bash
set -e

cd frontend
npm ci
npm run build
