Requiere Node.js 24.4+ y Chrome o Edge en Program Files. Para otra instalación, define `BROWSER_EXE`.
Desde la raíz, ejecuta `node docs/capturas/generar.mts`.
El script usa los datos de ejemplo y el renderizador del mod para crear HTML temporal y regenerar los diez PNG.
Si el entorno ya está aislado y Chrome headless no arranca, define `CAPTURAS_NO_SANDBOX=1` para renderizar ese HTML local.
