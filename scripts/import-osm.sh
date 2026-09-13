#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════
# OSM Import Script — runs inside the osm-import docker container
# Downloads OSM PBF for Southern Ontario, imports with osm2pgsql,
# then transforms into our road_segment / road_node schema.
# ═══════════════════════════════════════════════════════════════

PBF_FILE="/data/ontario-latest.osm.pbf"
BBOX="${OSM_EXTRACT_BBOX:--81.5,42.8,-78.2,45.0}"
OSM2PGSQL_CACHE=1024
OSM2PGSQL_NUMPROC=4

echo "═══════════════════════════════════════════════════════"
echo "  Truckmafia OSM Import"
echo "═══════════════════════════════════════════════════════"
echo "  BBOX: $BBOX"
echo "  PBF:  $PBF_FILE"
echo ""

# ── Step 1: Download PBF if not present ──────────────────────
if [ ! -f "$PBF_FILE" ]; then
  echo "📥 Downloading OSM PBF from Geofabrik..."
  mkdir -p /data
  curl -L -o "$PBF_FILE" "https://download.geofabrik.de/north-america/canada/ontario-latest.osm.pbf"
  echo "✅ Downloaded $(du -h "$PBF_FILE" | cut -f1)"
else
  echo "✅ PBF already exists ($(du -h "$PBF_FILE" | cut -f1))"
fi

# ── Step 2: Extract bounding box with osmium (if available) ──
EXTRACT_FILE="/data/southern-ontario.osm.pbf"
if command -v osmium &>/dev/null; then
  echo "✂️  Extracting bbox $BBOX..."
  osmium extract --bbox="$BBOX" -o "$EXTRACT_FILE" "$PBF_FILE" 2>/dev/null || {
    echo "  osmium extract failed, using full PBF"
    EXTRACT_FILE="$PBF_FILE"
  }
else
  echo "  osmium not available, using full PBF"
  EXTRACT_FILE="$PBF_FILE"
fi

# ── Step 3: Run osm2pgsql ────────────────────────────────────
echo ""
echo "🗄️  Running osm2pgsql import..."
osm2pgsql \
  --create \
  --slim \
  --cache="$OSM2PGSQL_CACHE" \
  --number-processes="$OSM2PGSQL_NUMPROC" \
  --host="$PGHOST" \
  --port="5432" \
  --username="$PGUSER" \
  --database="$PGDATABASE" \
  "$EXTRACT_FILE"

echo "✅ osm2pgsql import complete"

# ── Step 4: Transform OSM data into our schema ──────────────
echo ""
echo "🔄 Transforming OSM data into road_segment / road_node..."

psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -f /scripts/transform-osm.sql

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ OSM Import Complete!"
echo "═══════════════════════════════════════════════════════"
