#!/usr/bin/env bash
# Respaldo cifrado de ChispaBox: volúmenes de Caddy (certificados y cuenta ACME) y archivos de
# configuración con secretos. Se cifra en el VPS con la CLAVE PÚBLICA de age; la clave privada
# nunca está en el servidor. Se sube con rclone (Cloudflare R2 u otro destino compatible).
#
# Orden de seguridad: 1) respaldo y cifrado, 2) subida, 3) verificación del destino,
# 4) SOLO si la verificación pasa, limpieza de respaldos antiguos. Si cualquier paso falla,
# no se borra nada del destino.
#
# Variables (en el entorno, o en un archivo fuera de Git con permisos 600 que se carga antes):
#   RESPALDO_CLAVE_PUBLICA  archivo con la clave pública de age (age1...). Obligatoria.
#   RESPALDO_DESTINO        destino rclone, p. ej. r2:chispabox-respaldos. Obligatoria.
#   RESPALDO_CONFIG_DIR     directorio con proxy/.env y chispabox/sugerencias.env
#                           (por defecto /opt/src-chispabox/deploy, donde los leen los compose).
#   RESPALDO_RETENCION_DIAS antigüedad para borrar respaldos (por defecto 30).
#   RESPALDO_VERSIONES_MIN  versiones que se conservan siempre, aunque sean antiguas (por defecto 5).
#   RESPALDO_IMAGEN_TAR     imagen con tar para leer volúmenes (por defecto alpine:3.20).
set -euo pipefail
umask 077

: "${RESPALDO_CLAVE_PUBLICA:?Falta RESPALDO_CLAVE_PUBLICA (archivo con la clave pública de age)}"
: "${RESPALDO_DESTINO:?Falta RESPALDO_DESTINO (p. ej. r2:chispabox-respaldos)}"
RESPALDO_CONFIG_DIR="${RESPALDO_CONFIG_DIR:-/opt/src-chispabox/deploy}"
RESPALDO_RETENCION_DIAS="${RESPALDO_RETENCION_DIAS:-30}"
RESPALDO_VERSIONES_MIN="${RESPALDO_VERSIONES_MIN:-5}"
RESPALDO_IMAGEN_TAR="${RESPALDO_IMAGEN_TAR:-alpine:3.20}"

fallo() { echo "ERROR: $*" >&2; exit 1; }

for orden in docker age rclone sha256sum tar; do
  command -v "$orden" >/dev/null || fallo "Falta $orden"
done
[ -r "$RESPALDO_CLAVE_PUBLICA" ] || fallo "No se puede leer la clave pública: $RESPALDO_CLAVE_PUBLICA"
for archivo in "$RESPALDO_CONFIG_DIR/proxy/.env" "$RESPALDO_CONFIG_DIR/chispabox/sugerencias.env"; do
  [ -f "$archivo" ] || fallo "Falta $archivo"
  permisos="$(stat -c %a "$archivo")"
  [ "$permisos" = "600" ] || fallo "$archivo debe tener permisos 600 (tiene $permisos)"
done
[ "$RESPALDO_VERSIONES_MIN" -ge 1 ] 2>/dev/null || fallo "RESPALDO_VERSIONES_MIN debe ser un número mayor que 0"

DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# 1. Volúmenes de Caddy en solo lectura, por la salida estándar (sin rutas del host).
#    Se excluyen los logs: el registro de accesos no se respalda; su retención es de 30 días en Caddy.
docker run --rm \
  -v proxy_caddy_data:/datos:ro -v proxy_caddy_config:/config:ro \
  "$RESPALDO_IMAGEN_TAR" \
  tar -czf - --exclude='*.log' --exclude='*.log.*' -C / datos config > "$DIR/volumenes.tgz" \
  || fallo "No se pudieron leer los volúmenes de Caddy"

# 2. Configuración y secretos (solo esos dos archivos).
tar -czf "$DIR/config.tgz" -C "$RESPALDO_CONFIG_DIR" proxy/.env chispabox/sugerencias.env

# 3. Cifrado con la clave pública y eliminación de los textos en claro.
for archivo in volumenes config; do
  age -R "$RESPALDO_CLAVE_PUBLICA" -o "$DIR/$archivo.tgz.age" "$DIR/$archivo.tgz"
  rm -f "$DIR/$archivo.tgz"
done
(cd "$DIR" && sha256sum ./*.age > SHA256SUMS.txt)

# 4. Subida a un directorio con marca de tiempo.
rclone copy "$DIR" "$RESPALDO_DESTINO/$STAMP" || fallo "La subida del respaldo $STAMP falló; no se borra nada"

# 5. Verificación: tamaños y sumas del destino frente a los archivos locales.
rclone check "$DIR" "$RESPALDO_DESTINO/$STAMP" --one-way \
  || fallo "La verificación del respaldo $STAMP falló; no se borra ningún respaldo antiguo"

# 6. Limpieza: solo después de una verificación correcta. Se conservan siempre las últimas
#    RESPALDO_VERSIONES_MIN versiones y se borran las anteriores a RESPALDO_RETENCION_DIAS días.
CORTE="$(date -u -d "-${RESPALDO_RETENCION_DIAS} days" +%Y%m%dT%H%M%SZ)"
mapfile -t ESTAMPAS < <(rclone lsf --dirs-only "$RESPALDO_DESTINO" | sed 's#/$##' | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort)
total="${#ESTAMPAS[@]}"
for ((i = 0; i < total - RESPALDO_VERSIONES_MIN; i++)); do
  vieja="${ESTAMPAS[$i]}"
  if [[ "$vieja" < "$CORTE" ]]; then
    rclone purge "$RESPALDO_DESTINO/$vieja"
    echo "Eliminado respaldo antiguo: $vieja"
  fi
done

echo "Respaldo $STAMP subido y verificado en $RESPALDO_DESTINO/$STAMP"
