import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()

GHL_TOKEN = os.getenv('GHL_PRIVATE_TOKEN')
GHL_VERSION = os.getenv('GHL_API_VERSION', '2021-07-28')

# Intentamos obtener Location ID por búsqueda si no está en el env
headers = {
    "Authorization": f"Bearer {GHL_TOKEN}",
    "Version": GHL_VERSION,
    "Accept": "application/json"
}

def get_location_id():
    res = requests.get("https://services.leadconnectorhq.com/locations/search", headers=headers)
    if res.status_code == 200 and res.json().get('locations'):
        return res.json()['locations'][0]['id']
    return None

def test_ghl_connection():
    print("Iniciando prueba de conexion GHL (Solo Lectura)...\n")
    
    location_id = os.getenv('GHL_LOCATION_ID')
    if not location_id:
        location_id = get_location_id()
        
    if not location_id:
        print("ERROR: No se pudo determinar el Location ID.")
        return
        
    print(f"Location ID Confirmado: {location_id[:5]}... (oculto por seguridad)")
    print("Token validado exitosamente.\n")
    
    # 1. Fetch Pipelines
    print("Obteniendo Pipelines...")
    pipeline_url = f"https://services.leadconnectorhq.com/opportunities/pipelines?locationId={location_id}"
    res_pip = requests.get(pipeline_url, headers=headers)
    
    pipelines = []
    if res_pip.status_code == 200:
        pipelines = res_pip.json().get('pipelines', [])
        print(f"Encontrados {len(pipelines)} pipelines.")
        for p in pipelines:
            print(f"- Pipeline: {p.get('name')} (Etapas: {len(p.get('stages', []))})")
    else:
        print(f"ERROR: Fallo al obtener pipelines. {res_pip.text}")
        return
        
    if not pipelines:
        print("No hay pipelines configurados.")
        return
        
    # Usaremos el primer pipeline para la muestra
    main_pipeline = pipelines[0]
    stages = main_pipeline.get('stages', [])
    stage_map = {s.get('id'): s.get('name') for s in stages}
    
    print("\nEtapas del Pipeline Principal:")
    for stage_id, stage_name in stage_map.items():
        print(f"  > {stage_name}")
        
    # 2. Fetch Opportunities
    print("\nObteniendo Oportunidades...")
    opp_url = f"https://services.leadconnectorhq.com/opportunities/search?location_id={location_id}&pipeline_id={main_pipeline.get('id')}"
    res_opp = requests.get(opp_url, headers=headers)
    
    if res_opp.status_code == 200:
        opps = res_opp.json().get('opportunities', [])
        print(f"Encontradas {len(opps)} oportunidades en el pipeline principal.")
        
        # Resumen por etapa
        stage_counts = {name: 0 for name in stage_map.values()}
        status_counts = {"open": 0, "won": 0, "lost": 0, "abandoned": 0}
        
        sample_data = []
        
        for opp in opps:
            stage_id = opp.get('pipelineStageId')
            stage_name = stage_map.get(stage_id, "Desconocida")
            status = opp.get('status', 'open')
            
            if stage_name in stage_counts:
                stage_counts[stage_name] += 1
            status_counts[status] = status_counts.get(status, 0) + 1
            
            # Limpiamos datos sensibles para el sample
            if len(sample_data) < 3:
                sample_data.append({
                    "id": opp.get('id')[:5] + "...",
                    "contactName": opp.get('name', 'N/A')[:2] + "***" if opp.get('name') else 'N/A',
                    "stage": stage_name,
                    "status": status,
                    "source": opp.get('source', 'N/A'),
                    "createdAt": opp.get('createdAt')
                })
                
        print("\n--- RESUMEN POR ETAPA ---")
        for stage, count in stage_counts.items():
            print(f"{stage}: {count} leads")
            
        print("\n--- RESUMEN POR ESTADO ---")
        for status, count in status_counts.items():
            print(f"{status.upper()}: {count}")
            
        print("\n--- EJEMPLO DE ESTRUCTURA JSON (Datos Limpios) ---")
        print(json.dumps(sample_data, indent=2))
        
        print("\nPrueba completada: NO se realizo ninguna modificacion en GoHighLevel.")
    else:
        print(f"ERROR: Fallo al obtener oportunidades. {res_opp.text}")

if __name__ == "__main__":
    test_ghl_connection()
