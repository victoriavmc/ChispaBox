# Cómo poner ChispaBox en Hostinger (VPS KVM 2)

Guía paso a paso para instalar ChispaBox en un VPS de Hostinger con Docker. Está pensada para hacerse en orden. **No actives el dominio público hasta completar la sección 10.**

> Convenciones: los textos entre `<...>` son valores tuyos (dominio, correo, etc.). **Nunca escribas contraseñas, claves ni tokens en el repositorio, en un chat o en un registro.** Los secretos se escriben directamente en el servidor.

## Qué vas a necesitar

- Un **VPS Hostinger KVM 2** (anotá las especificaciones reales que muestra el panel: CPU, RAM y disco).
- Un **dominio** con acceso a su zona DNS (sin `www`; `www` redirige al dominio).
- Una cuenta de **Gmail** para el buzón del formulario, con verificación en dos pasos y una **contraseña de aplicación**.
- Una cuenta de **UptimeRobot** (plan gratuito) para el monitoreo (se crea después).
- Este repositorio: `https://github.com/victoriavmc/ChispaBox`.

## 1. Punto de partida: el KVM 2 ya contratado

Ya tenés contratado un **Hostinger KVM 2**. **No reinstales el sistema operativo** ni hagas cambios en el servidor sin antes completar la sección 3.

- Sistema operativo verificado en el servidor: **Ubuntu 26.04.1 LTS** (2 vCPU, 7,7 GiB de RAM, disco de 96 GiB). Confirmalo de nuevo con `cat /etc/os-release` antes de cada cambio.
- Anotá las especificaciones que muestra el panel y revisá que coincidan con lo anterior.
- Si el servidor ya tiene datos, aplicaciones o servicios en uso, **no los modifiques**: documentalos y decidí cómo convivir con ellos antes de instalar ChispaBox.
- Guardá la contraseña de acceso que muestra el panel en tu gestor de contraseñas. Vas a cambiar el acceso en la sección 2.

## 2. Primer acceso seguro

Hacé estos pasos **solo después** de confirmar que podés entrar con tu acceso actual y de haber revisado el diagnóstico de la sección 3. Mantené siempre una sesión abierta mientras cambiás la configuración SSH.

```bash
ssh root@<IP-DEL-VPS>
```

1. Creá un usuario de administración con permisos sudo (solo si no existe ya uno):
   ```bash
   adduser <tu-usuario>
   usermod -aG sudo <tu-usuario>
   ```
2. Copiá tu clave pública SSH a ese usuario (desde tu computadora: `ssh-copy-id <tu-usuario>@<IP-DEL-VPS>`).
3. Probá entrar con ese usuario **en otra sesión** antes de cerrar la de root.
4. Solo entonces, desactivá el acceso por contraseña y el login de root en `/etc/ssh/sshd_config` (`PasswordAuthentication no`, `PermitRootLogin no`) y reiniciá SSH con `sudo systemctl restart ssh`. Si algo falla, usá la sesión abierta para revertirlo.
5. Actualizá los paquetes del sistema: `sudo apt update && sudo apt upgrade -y`. Antes, revisá en el diagnóstico qué servicios dependen de ellos.

## 3. Diagnóstico del servidor (solo lectura)

Antes de instalar, comprobá que el servidor está como esperás. No asumas que está vacío.

```bash
# Sistema y recursos
lsb_release -a; uname -r; free -h; nproc; df -h /

# Puertos ocupados (80, 443 deben estar libres)
sudo ss -tulpn

# Contenedores y servicios existentes
docker ps -a 2>/dev/null || echo "Docker no instalado"
systemctl list-units --type=service --state=running | head -40
ls -la /opt 2>/dev/null

# Cortafuegos
sudo ufw status verbose 2>/dev/null || echo "ufw no activo"

# Conectividad SMTP saliente (no envía correo)
timeout 10 bash -c '</dev/tcp/smtp.gmail.com/465' && echo "465 abierto" || echo "465 bloqueado"
timeout 10 bash -c '</dev/tcp/smtp.gmail.com/587' && echo "587 abierto" || echo "587 bloqueado"
```

Qué hacer con el resultado:
- Si **80 o 443** están ocupados por otro servicio, no instales ChispaBox hasta decidir qué hacer con ese servicio.
- Si **465 y 587 están bloqueados**, el formulario de sugerencias no puede enviar correos por Gmail. Resolvelo antes de publicar.

## 4. Instalar Docker y Compose

Swap: el servidor no tenía. Se agregó un archivo de 2 GiB (`/swapfile`, permisos 600) y se dejó persistente en `/etc/fstab`. Verificá con `swapon --show`.

Si Docker ya está instalado, **no lo reinstales**: verificá la versión y seguí con el paso 5.

Seguí la instalación oficial de Docker Engine para Ubuntu (repositorio de Docker). En Ubuntu 26.04 (`resolute`) el repositorio `download.docker.com` ya publica los paquetes. Registro de la instalación realizada el 16 nov 2026: Docker Engine 29.10.0 y Compose v5.7.1.

Verificá:

```bash
docker --version
docker compose version
sudo usermod -aG docker <tu-usuario>   # cerrá y abrí la sesión después
```

Hacé que Docker arranque con el sistema:

```bash
sudo systemctl enable --now docker
```

Anotá las versiones instaladas en tu registro de la puesta en marcha.

## 5. Obtener el código en una versión fija

Todavía **no existe ninguna etiqueta Git** en el repositorio. Las etiquetas se crean al aprobar una versión, no antes. Hasta entonces, no hay nada que desplegar.

Cuando la versión esté aprobada, la etiqueta se crea sobre el commit aprobado (`git tag vX.Y.Z <commit>` y `git push origin vX.Y.Z`). En el servidor:

```bash
sudo mkdir -p /opt && sudo git clone https://github.com/victoriavmc/ChispaBox.git /opt/src-chispabox
sudo chown -R <tu-usuario>: /opt/src-chispabox
cd /opt/src-chispabox
git tag --list                  # debe mostrar la etiqueta aprobada
git checkout <etiqueta-aprobada>
git rev-parse HEAD              # anotá este commit en tu registro
```

Cada despliegue se hace desde una etiqueta identificada. No se despliega desde `master` sin fijar.

## 6. Crear la configuración en el servidor

Creá las carpetas y los archivos de configuración **con permisos restrictivos**. Los valores los escribís vos, en el servidor.

```bash
# Proxy (Caddy): dominio y correo para los certificados
sh -c 'umask 077; cat > /opt/src-chispabox/deploy/proxy/.env' <<'EOF'
CHISPABOX_DOMAIN=<tu-dominio.com>
ACME_EMAIL=<tu-correo@dominio.com>
EOF

# Formulario: SMTP de Gmail y secretos del servidor
umask 077; cp /opt/src-chispabox/deploy/chispabox/sugerencias.env.example /opt/src-chispabox/deploy/chispabox/sugerencias.env
chmod 600 /opt/src-chispabox/deploy/chispabox/sugerencias.env
nano /opt/src-chispabox/deploy/chispabox/sugerencias.env     # completá los valores aquí, en el servidor
```

Completá `sugerencias.env` así (sin pegar valores reales en el repositorio):
- `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`
- `SMTP_USER` y `SMTP_PASS`: cuenta de Gmail y **contraseña de aplicación**
- `MAIL_TO`: buzón que recibe las sugerencias; `MAIL_FROM`: remitente
- `ALLOWED_ORIGIN=https://<tu-dominio.com>`
- `IP_SALT` y `CAPTCHA_SECRET`: generalos en el servidor con `openssl rand -hex 32` y pegalos en el archivo. **Guardalos también fuera del servidor**, en un gestor de contraseñas.

Comprobá los permisos: `ls -l /opt/src-chispabox/deploy/proxy/.env /opt/src-chispabox/deploy/chispabox/sugerencias.env` debe mostrar `-rw-------`.

## 7. Construir y arrancar

```bash
# 7.1 Validar la configuración antes de arrancar
cd /opt/src-chispabox/deploy/proxy
docker compose -f compose.yaml config -q && echo "proxy OK"
cd /opt/src-chispabox/deploy/chispabox
docker compose -f compose.yaml config -q && echo "chispabox OK"

# 7.2 Crear la red compartida y arrancar el proxy
cd /opt/src-chispabox/deploy/proxy
docker compose -f compose.yaml up -d

# 7.3 Construir las imágenes desde el checkout y arrancar ChispaBox
cd /opt/src-chispabox/deploy/chispabox
docker compose -f compose.yaml build
docker compose -f compose.yaml up -d

# 7.4 Revisar el estado
docker compose -f compose.yaml ps
docker logs --tail 50 chispabox-sugerencias
```

Notas:
- El proxy escucha en 80 y 443. Caddy obtiene el certificado automáticamente cuando el dominio ya apunta al servidor (sección 10).
- `chispabox-web` y `chispabox-sugerencias` **no publican puertos**: solo los atiende Caddy.
- La imagen web no incluye `extras/local/` (las herramientas locales no se publican en el servidor).

## 8. Pruebas antes del dominio público (sin cambiar DNS)

Probá contra la IP del servidor usando `--resolve`, que no cambia el DNS. **Advertencia:** estas pruebas no garantizan que el certificado TLS público se emita. Caddy solo lo obtiene cuando el dominio apunta al servidor y el desafío de validación del dominio (HTTP-01 por el puerto 80) llega al VPS. Hasta entonces, el navegador puede mostrar un certificado no válido.

```bash
IP=<IP-DEL-VPS>; D=<tu-dominio.com>
curl -sI --resolve $D:443:$IP https://$D/ | head -12          # 200, HSTS, CSP, Referrer-Policy
curl -s  --resolve $D:443:$IP -o /dev/null -w "%{http_code}\n" https://$D/no-existe   # 404
curl -s  --resolve $D:443:$IP https://$D/api/sugerencias/captcha   # JSON con pregunta
```

Lista de comprobación:
- [ ] La portada carga por HTTPS y el certificado es válido (cuando el DNS esté listo, ver sección 10).
- [ ] Una página inexistente muestra la página 404 personalizada con código 404.
- [ ] Los enlaces cortos (`/s/CODIGO`) abren el acortador.
- [ ] Una herramienta funciona en el navegador (p. ej., convertir imagen).
- [ ] El formulario envía una sugerencia de prueba: el buzón recibe el aviso y el remitente recibe el agradecimiento (con tu aprobación para enviar un correo real).
- [ ] Los registros de Caddy no contienen códigos de enlaces cortos ni datos del formulario (`docker exec proxy-caddy sh -c 'tail -n 5 /data/access-chispabox.log'`).

## 9. Copias de seguridad

Por ahora no hay respaldos automáticos. Antes de cada actualización, guardá fuera del servidor una copia de `deploy/proxy/.env` y `deploy/chispabox/sugerencias.env`. Son datos sensibles: guardalos cifrados o en un gestor de contraseñas.

## 10. Activar el dominio público (último paso)

Solo cuando las secciones 2 a 9 estén completas:

1. **DNS**: creá un registro `A` para `<tu-dominio.com>` con la IP del VPS. Creá un registro para `www` que apunte a la misma IP (la redirección de `www` la hace Caddy). Esperá a que propague (`dig +short <tu-dominio.com>`).
2. Comprobá que Caddy obtiene el certificado: `docker logs proxy-caddy --tail 30` debe mostrar la obtención del certificado sin errores.
3. Abrí `https://<tu-dominio.com>/` desde tu navegador y repetí la lista de la sección 8 sin `--resolve`.
4. Configurá el **monitoreo** en UptimeRobot (plan gratuito): un monitor HTTPS de `https://<tu-dominio.com>/` y otro de `https://<tu-dominio.com>/api/sugerencias/captcha`, con alertas por correo. Verificá que la alerta llega.
5. Revisá cada semana: `docker compose ps`, espacio en disco (`df -h`) y la fecha de vencimiento del certificado:
   ```bash
   echo | openssl s_client -connect <tu-dominio.com>:443 -servername <tu-dominio.com> 2>/dev/null | openssl x509 -noout -enddate
   ```

## 11. Actualizar y volver atrás

Actualizar a una nueva versión:
```bash
cd /opt/src-chispabox && git fetch --tags && git checkout <nueva-etiqueta>
cd deploy/chispabox && docker compose -f compose.yaml build && docker compose -f compose.yaml up -d
```

Volver a la versión anterior: `git checkout <etiqueta-anterior>` y repetir la construcción y el arranque.

Antes de cada actualización, guardá fuera del servidor los archivos `.env` y `sugerencias.env` (sección 9).

## 12. Qué NO hacer

- No pegues contraseñas, claves ni tokens en el repositorio, en issues ni en chats.
- No publiques `*.env` ni `sugerencias.env`.
- No cambies la retención de Gmail ni el buzón sin revisar sus efectos.
- No actives el dominio antes de completar la sección 8.

## Pendientes que dependen de tu cuenta

- Especificaciones reales del KVM 2 y resultado del diagnóstico de la sección 3.
- Conectividad SMTP 465/587 desde el servidor.
- Cuenta de UptimeRobot.

## 13. Verificar los compose con Compose v5 (antes del primer arranque)

El servidor tiene Compose v5.7.1. Antes de construir o arrancar, validá los archivos con esa versión:

```bash
cd /opt/src-chispabox/deploy/proxy
docker compose -f compose.yaml config > /dev/null && echo "proxy: sintaxis OK"
cd /opt/src-chispabox/deploy/chispabox
docker compose -f compose.yaml config > /dev/null && echo "chispabox: sintaxis OK"
```

Si alguno falla, no arranques: pegá el mensaje de error completo para revisarlo.
