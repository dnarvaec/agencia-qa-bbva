# Contexto del Proyecto

> Este archivo contiene toda la información específica del cliente y la aplicación bajo prueba.
> **Para migrar la agencia a un nuevo cliente**, modifica únicamente este archivo.
> Los 4 agentes leen este archivo en bootstrap para obtener el contexto necesario.

---

## Proyecto

| Campo | Valor |
|---|---|
| **Nombre del proyecto** | BBVA Colombia — Preformalización de Cuenta de Nómina (Open Market / App GloMo) |
| **HU de referencia** | [QSSOBBVA-28](../../archivos/HUs/QSSOBBVA-28/QSSOBBVA-28-final.md) — Preformalización de Cuenta de Nómina y Enrolamiento de Usuario en Open Market (oM) |
| **Alcance de la prueba (demo)** | Solo **web** — flujo público de apertura de cuenta (onboarding), sin login previo |

---

## Aplicación Bajo Prueba (AUT)

| Entorno | URL |
|---|---|
| **Web** | `${APP_URL}` — ver `.env` (app "CuentaWebGlomo", ambiente QA, arquitectura cells/vulcanize) |
| **API** | N/A — fuera de alcance para esta demo |

### Módulos de la Aplicación

Flujo único de preformalización 100% digital ("Hazte cliente en menos de 10 minutos con la Cuenta en Línea de Nómina"), compuesto por 5 pasos secuenciales (según HU QSSOBBVA-28):

1. **Momento Cero — Datos Personales**: captura de nombres, documento, fecha de expedición, fecha de nacimiento, celular y correo. Valida en tiempo real contra **CIFIN** y **SOI (Motor Laboral)**; si falla, informa el motivo y bloquea el avance.
2. **Información Complementaria y Domicilio**: departamento/ciudad de expedición, ocupación, origen de fondos, declaración PEP/FATCA-CRS, dirección de residencia estructurada.
3. **Llave BBVA y Aceptación de TyC**: asignación de llave (alias para transferencias), aceptación de reglamento de cuenta, TyC de la App GloMo y exención de GMF (4x1000).
4. **Creación de Contraseña de Acceso (GloMo)**: validación de política de seguridad (mayúsculas, números, caracteres especiales, longitud mínima); error visible si no cumple.
5. **Confirmación / Call to Action**: pantalla final *"Te falta un paso para completar la activación de tu Cuenta de Nómina"*, invita a descargar la App GloMo e iniciar sesión con la clave recién creada.

---

## Credenciales de Prueba

> No aplica un usuario/contraseña previo: es un flujo público de **alta de cliente nuevo** (onboarding), no de login a una cuenta existente.
> Los "datos de prueba" son los que el propio flujo solicita paso a paso (documento de identidad, celular, correo, contraseña nueva, etc.) — deben ser datos válidos y elegibles en CIFIN/SOI para poder avanzar; pendiente de definir un set de datos de prueba QA con el equipo funcional.

---

## Comportamientos Conocidos de la Aplicación

- Validaciones de existencia/elegibilidad contra **CIFIN** y **SOI (Motor Laboral)** en el Paso 1 — bloquean el avance si el cliente no es elegible.
- Política de contraseña del Paso 4: requiere mayúsculas, números, caracteres especiales y longitud mínima; muestra mensaje de error si no se cumple.
- Mensaje textual exacto de éxito (Paso 5): **"Te falta un paso para completar la activación de tu Cuenta de Nómina"**.
- Aplicación construida con arquitectura **cells/vulcanize** (Polymer) — considerar tiempos de carga de Web Components y posible necesidad de esperas explícitas en la automatización.

---

## Selectores Estables Conocidos

> Pendiente — se completa durante la exploración en vivo con Playwright MCP (agente "Automatizar y Ejecutar"). No inventar selectores aquí.

---

## Variables de Entorno Requeridas (Definidas en .env)

| Variable | Descripción |
|---|---|---|
| `AZURE_DEVOPS_ORG_URL` | URL de la organización |
| `AZURE_DEVOPS_PROJECT` | Nombre del proyecto |
| `AZURE_DEVOPS_PAT` | Token de acceso personal |
| `APP_URL` | URL base de la aplicación web (CuentaWebGlomo, ambiente QA) |
| `API_URL` | URL base de la api |
| `AGENT_UI_PORT` | Puerto del servidor local Express (3000) |
