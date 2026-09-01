"""
Sube casos de prueba desde un JSON (formato `{CP_ID}-test-cases.json`) como
Test Cases de QMetry (QTM4J), vía la API interna `/rest/qtm4j/ui/latest/testcases`.

Autenticación: Basic Auth con JIRA_USERNAME/JIRA_API_TOKEN.

Uso:
    python jira_uploader.py "archivos/Casos de Prueba/1037/1037-test-cases.json" [indice_inicio]

    indice_inicio (opcional): índice base 0 o base 1 del caso dentro del array `test_cases`
    desde el cual reanudar la subida (por defecto 1, el primer caso).
"""
import json
import os
import sys
import requests
from dotenv import load_dotenv

FOLDER_ID_DEFAULT = -1     # Sin carpeta, raíz del proyecto QMetry
PRIORITY_ID_DEFAULT = 1906  # "High"
STATUS_ID_DEFAULT = 4290    # "To Do"


def _cargar_configuracion():
    load_dotenv()
    faltantes = [
        var for var in ("JIRA_URL", "JIRA_USERNAME", "JIRA_API_TOKEN", "QMETRY_PROJECT_ID")
        if not os.getenv(var)
    ]
    if faltantes:
        raise RuntimeError(f"Faltan variables en .env: {', '.join(faltantes)}")
    return {
        "jira_url": os.environ["JIRA_URL"].rstrip("/"),
        "username": os.environ["JIRA_USERNAME"],
        "token": os.environ["JIRA_API_TOKEN"],
        "project_id": int(os.environ["QMETRY_PROJECT_ID"]),
    }


def _formatear_precondiciones(preconditions):
    if isinstance(preconditions, list):
        return "\n".join(f"• {p}" for p in preconditions)
    return str(preconditions or "")


def _formatear_descripcion(tc):
    partes = []
    if tc.get("description"):
        partes.append(tc["description"])
    if tc.get("objective"):
        partes.append(f"\nObjetivo: {tc['objective']}")
    if tc.get("automation_notes"):
        partes.append(f"\nNotas de Automatización: {tc['automation_notes']}")
    return "\n".join(partes)


def _payload_test_case(tc, project_id):
    pasos = []
    for step in sorted(tc.get("steps", []), key=lambda x: x.get("order", 0)):
        pasos.append({
            "stepDetails": step.get("action") or "",
            "testData": step.get("data") or "",
            "expectedResult": step.get("expected_result") or "",
            "isChecked": False,
            "isExpanded": True,
        })

    return {
        "summary": tc.get("title") or "",
        "description": _formatear_descripcion(tc),
        "precondition": _formatear_precondiciones(tc.get("preconditions")),
        "folderId": FOLDER_ID_DEFAULT,
        "projectId": project_id,
        "priority": PRIORITY_ID_DEFAULT,
        "status": STATUS_ID_DEFAULT,
        "steps": pasos,
    }


def _crear_test_case(sesion, config, payload):
    url = f"{config['jira_url']}/rest/qtm4j/ui/latest/testcases"
    respuesta = sesion.post(url, json=payload, timeout=30)
    if not respuesta.ok:
        raise RuntimeError(f"HTTP {respuesta.status_code}: {respuesta.text[:300]}")
    cuerpo = respuesta.json()
    return cuerpo["key"]


def subir_casos_a_qmetry(ruta_json, indice_inicio=1):
    config = _cargar_configuracion()
    
    with open(ruta_json, "r", encoding="utf-8") as f:
        datos = json.load(f)

    test_cases = datos.get("test_cases", [])
    if not test_cases:
        raise ValueError("El JSON no contiene ningún caso de prueba en 'test_cases'")

    sesion = requests.Session()
    sesion.auth = (config["username"], config["token"])

    creados, fallidos = {}, []

    for idx, tc in enumerate(test_cases[indice_inicio - 1:], start=indice_inicio):
        tc_id = tc.get("id", f"Caso-{idx}")
        titulo = tc.get("title", "Sin título")
        payload = _payload_test_case(tc, config["project_id"])
        
        try:
            key = _crear_test_case(sesion, config, payload)
        except Exception as error:
            fallidos.append((idx, tc_id, titulo, str(error)))
            continue

        creados[f"Caso {idx} ({tc_id})"] = key

    return {"creados": creados, "fallidos": fallidos}


def _imprimir_resumen(resultado):
    print(f"\nCreados : {len(resultado['creados'])}")
    for tc_label, key in resultado["creados"].items():
        print(f"  {tc_label} -> {key}")
    print(f"Fallidos: {len(resultado['fallidos'])}")
    for idx, tc_id, titulo, error in resultado["fallidos"]:
        print(f"  Caso {idx} ({tc_id}) [{titulo}] -> {error}")


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        print("Uso: python jira_uploader.py <ruta_al_json> [indice_inicio]")
        sys.exit(1)
    
    indice_inicio = int(sys.argv[2]) if len(sys.argv) == 3 else 1
    resultado = subir_casos_a_qmetry(sys.argv[1], indice_inicio)
    _imprimir_resumen(resultado)
    sys.exit(1 if resultado["fallidos"] else 0)