#!/usr/bin/env bash
# Restauración comprobable de un respaldo de ChispaBox en volúmenes NUEVOS (no sobrescribe los actuales).
# Requiere la CLAVE PRIVADA de age, custodiada fuera del VPS. Uso:
#   restaurar.sh <destino-rclone/ESTAMPA> <archivo-clave-privada-age> <sufijo-volumen>
# Crea proxy_caddy_data_<sufijo> y proxy_caddy_config_<sufijo>. La configuración descifrada se deja
# en un directorio temporal para revisarla y borrarla después de la prueba.
set -euo pipefail
umask 077

ORIGEN="${1:?Indica destino/ESTAMPA}"
CLAVE_PRIVADA="${2:?Indica el archivo con la clave privada de age}"
SUFIJO="${3:?Indica un sufijo para los volúmenes nuevos (p. ej. prueba)}"
IMAGEN_TAR="${RESPALDO_IMAGEN_TAR:-alpine:3.20}"

fallo() { echo "ERROR: $*" >&2; exit 1; }

for orden in docker age rclone sha256sum tar; do
  command -v "$orden" >/dev/null || fallo "Falta $orden"
done
[ -r "$CLAVE_PRIVADA" ] || fallo "No se puede leer la clave privada: $CLAVE_PRIVADA"
[[ "$SUFIJO" =~ ^[a-z0-9-]+$ ]] || fallo "El sufijo solo admite minúsculas, números y guiones"

# Los volúmenes de destino no pueden existir: así nunca se sobrescribe uno en uso.
for volumen in "proxy_caddy_data_$SUFIJO" "proxy_caddy_config_$SUFIJO"; do
  if docker volume inspect "$volumen" >/dev/null 2>&1; then
    fallo "El volumen $volumen ya existe; elegí otro sufijo"
  fi
done

DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT

# 1. Descarga y verificación de integridad antes de descifrar.
rclone copy "$ORIGEN" "$DIR/cifrado" || fallo "No se pudo descargar $ORIGEN"
(cd "$DIR/cifrado" && sha256sum -c SHA256SUMS.txt) || fallo "Las sumas no coinciden: el respaldo está dañado"

# 2. Descifrado con la clave privada.
for archivo in volumenes config; do
  age -d -i "$CLAVE_PRIVADA" -o "$DIR/$archivo.tgz" "$DIR/cifrado/$archivo.tgz.age" \
    || fallo "No se pudo descifrar $archivo (clave incorrecta o respaldo dañado)"
done

# 3. Restauración en volúmenes nuevos.
docker volume create "proxy_caddy_data_$SUFIJO" >/dev/null
docker volume create "proxy_caddy_config_$SUFIJO" >/dev/null
docker run --rm -i -v "proxy_caddy_data_$SUFIJO":/datos -v "proxy_caddy_config_$SUFIJO":/config \
  "$IMAGEN_TAR" tar -xzf - -C / < "$DIR/volumenes.tgz" || fallo "No se pudo restaurar el volumen"

# 4. Configuración descifrada, en un directorio aparte para revisión manual.
RESTAURADO="$(mktemp -d)"
tar -xzf "$DIR/config.tgz" -C "$RESTAURADO"

echo "Volúmenes restaurados: proxy_caddy_data_$SUFIJO, proxy_caddy_config_$SUFIJO"
echo "Configuración descifrada en: $RESTAURADO (revisar y borrar después de la prueba)"
