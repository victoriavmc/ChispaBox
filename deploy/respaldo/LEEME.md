# Respaldos cifrados de ChispaBox

Scripts para respaldar, cifrar y verificar la configuración y los certificados de ChispaBox, y para restaurarlos en volúmenes nuevos.

**Qué incluye un respaldo**: los volúmenes `proxy_caddy_data` (certificados y cuenta ACME) y `proxy_caddy_config`, y los archivos `proxy/.env` y `chispabox/sugerencias.env`.
**Qué NO incluye**: los registros de acceso de Caddy (`*.log`, con retención de 30 días en Caddy), ni las imágenes ni el código del sitio (se reconstruyen desde Git).

## Herramientas (en el VPS)

- `age` (BSD-3-Clause) para el cifrado, y `rclone` (MIT) para la subida. Instalación en Ubuntu 24.04: `sudo apt install age rclone` (las versiones del repositorio de Ubuntu pueden diferir de las de referencia; anotar la versión instalada).
- `docker`, `tar`, `sha256sum`, `stat`.

## Claves: fuera del VPS y fuera de Git

- **Clave pública de age**: se guarda en el VPS en `/opt/respaldo/clave-publica-age.txt`. Es la única clave que el servidor necesita.
- **Clave privada de age**: la custodia el titular, en una copia independiente del VPS (gestor de contraseñas o medio sin conexión). **Sin ella, un respaldo no se puede restaurar.** No se guarda en Git, ni en el VPS, ni en el chat.
- **Credenciales de R2**: se crean en el panel de Cloudflare con permiso solo sobre el bucket de respaldos y se escriben en `~/.config/rclone/rclone.conf` en el VPS (permisos 600). Plantilla sin valores: `rclone.conf.example`.

## Configuración

1. Copiar `respaldo.env.example` a `/opt/respaldo/respaldo.env` (permisos 600) y completar las rutas.
2. Los archivos `proxy/.env` y `chispabox/sugerencias.env` deben tener permisos **600**. El script se niega a continuar si no los tienen.

## Uso

```bash
set -a; . /opt/respaldo/respaldo.env; set +a
/ruta/a/deploy/respaldo/respaldar.sh
```

Orden de seguridad del script:
1. Lee los volúmenes en solo lectura y cifra con la clave pública.
2. Sube el respaldo a una carpeta con marca de tiempo.
3. **Verifica** el destino con `rclone check`.
4. **Solo si la verificación es correcta**, borra respaldos antiguos. Se conservan siempre las últimas `RESPALDO_VERSIONES_MIN` (5) versiones, y se borran las que superen `RESPALDO_RETENCION_DIAS` (30).

Si falla cualquier paso, el script termina con error y **no borra nada** del destino.

Programación sugerida (cron de root, una vez al día): `15 3 * * * . /opt/respaldo/respaldo.env && /ruta/a/respaldar.sh >> /var/log/chispabox-respaldo.log 2>&1`. El registro del respaldo no contiene secretos, pero conviene revisarlo.

## Restauración comprobable

1. Elegir una carpeta del destino (`rclone lsf r2:chispabox-respaldos`).
2. En una máquina de prueba o en el VPS, con la clave privada disponible solo para este paso:
   ```bash
   ./restaurar.sh r2:chispabox-respaldos/<ESTAMPA> /ruta/a/clave-privada-age.txt prueba1
   ```
3. El script verifica las sumas, descifra y restaura en volúmenes **nuevos** (`proxy_caddy_data_prueba1`, `proxy_caddy_config_prueba1`). Nunca sobrescribe volúmenes existentes.
4. Revisar la configuración descifrada en la carpeta que indica el script y borrarla después.
5. Comprobar el certificado y la cuenta con un Caddy de prueba antes de usar esos volúmenes en producción.

## Pruebas realizadas (16 nov 2026)

Probado en un contenedor con claves y configuración **de prueba**, con destino local (no Cloudflare R2):
- Respaldo normal: sumas verificadas; el contenido cifrado no incluye registros `*.log`.
- Retención: se borraron respaldos de más de 30 días y se conservaron las versiones mínimas.
- Fallo de subida: se terminó con error y **no se borró nada**.
- Permisos incorrectos (644): el script se negó a continuar.
- Restauración en volúmenes nuevos: correcta. Repetir con el mismo sufijo: negada. Clave incorrecta: negada.

**No probado todavía**: el destino Cloudflare R2 real, el fallo de la verificación (`rclone check`) en condiciones reales, y la restauración en el VPS.
