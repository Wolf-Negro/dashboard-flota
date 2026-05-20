import os
from flask import Flask, render_template, jsonify, request
import requests
from datetime import datetime, timedelta
import pytz
import calendar
from dotenv import load_dotenv
import json
import traceback
import time

# Cargar variables de entorno
load_dotenv()

app = Flask(__name__)

# Configuración de Meta Ads
ACCESS_TOKEN = os.environ.get('META_ACCESS_TOKEN')
AD_ACCOUNT_ID = os.environ.get('AD_ACCOUNT_ID', 'act_1184698167137626')
MONTHLY_BUDGET = float(os.environ.get('MONTHLY_BUDGET', 2000))
CLIENT_NAME = os.environ.get('CLIENT_NAME', 'FLOTA DASHBOARD')
CURRENCY = os.environ.get('CURRENCY', 'PEN')

PERU_TZ = pytz.timezone('America/Lima')

# Simple Cache en memoria
CACHE = {}
CACHE_EXPIRY = 300 # 5 minutos

def get_peru_now():
    return datetime.now(PERU_TZ)

def classify_campaign(name, action_types):
    name = name.lower()
    # Listas de keywords
    msg_keys = ["mensaje", "mensajes", "whatsapp", "wsp", "conv"]
    lead_keys = ["lead", "leads", "cliente potencial"]
    pos_keys = ["posiciona", "posciona", "video", "reproduccion", "reach", "alcance", "frio", "thruplay"]
    
    # Action types
    msg_actions = [
        'onsite_conversion.messaging_conversation_started_7d',
        'messaging_conversation_started_7d',
        'messaging_first_reply'
    ]
    lead_actions = [
        'lead',
        'onsite_conversion.lead_grouped',
        'offsite_conversion.fb_pixel_lead',
        'leadgen_grouped'
    ]
    pos_actions = [
        'video_view', 'thruplay', 'video_thruplay_watched_actions', 'post_engagement'
    ]

    # 1. Clasificación por acciones (más precisa)
    if any(a in action_types for a in lead_actions):
        return 'Leads'
    if any(a in action_types for a in msg_actions):
        return 'Mensajes'
    if any(a in action_types for a in pos_actions):
        return 'Posicionamiento'

    # 2. Clasificación por nombre (Prioridad a Posicionamiento si hay conflicto)
    if any(k in name for k in pos_keys):
        return 'Posicionamiento'
    if any(k in name for k in lead_keys):
        return 'Leads'
    if any(k in name for k in msg_keys) or "remarketing" in name:
        return 'Mensajes'
    
    return 'Posicionamiento'

def get_action_value(actions, types):
    # Meta often reports the same conversion under different action_type names.
    # We take the maximum value found among the requested types to avoid double counting.
    values = [int(a.get('value', 0)) for a in actions if a.get('action_type') in types]
    return max(values) if values else 0

@app.route('/')
def index():
    return render_template('index.html', client_name=CLIENT_NAME)

@app.route('/api/data')
def get_dashboard_data():
    month = request.args.get('month')
    now = get_peru_now()
    today_str = now.strftime('%Y-%m-%d')
    
    if not month:
        month = today_str[:7] # YYYY-MM

    # Verificar Cache
    cache_key = f"dashboard_{month}"
    if cache_key in CACHE:
        data, timestamp = CACHE[cache_key]
        if time.time() - timestamp < CACHE_EXPIRY:
            print(f"DEBUG: Sirviendo data desde cache para {month}")
            return jsonify(data)

    try:
        year, month_num = map(int, month.split('-'))
        ultimo_dia = calendar.monthrange(year, month_num)[1]
        since_date = f"{year}-{month_num:02d}-01"
        until_date = f"{year}-{month_num:02d}-{ultimo_dia}"
        
        # Si es el mes actual, no podemos pedir el futuro
        if month == today_str[:7]:
            until_date = today_str

        print(f"DEBUG: Fetching data for {since_date} to {until_date}")

        url_insights = f"https://graph.facebook.com/v19.0/{AD_ACCOUNT_ID}/insights"
        
        # 1. Insights por Campaña (Diario) - Para Gráficos y Tabla
        params_camp = {
            'access_token': ACCESS_TOKEN,
            'level': 'campaign',
            'fields': 'campaign_name,spend,actions,date_start,reach,impressions,clicks,inline_link_click_ctr,cpm,cpc,objective,video_thruplay_watched_actions',
            'time_range': json.dumps({"since": since_date, "until": until_date}),
            'time_increment': 1,
            'limit': '5000'
        }
        
        res_camp = requests.get(url_insights, params=params_camp, timeout=30).json()
        camp_raw = res_camp.get('data', [])
        
        if 'error' in res_camp:
            return jsonify({"status": "error", "message": res_camp['error'].get('message')})

        # Procesamiento de Data Diaria
        daily_map = {} # date -> metrics

        msg_actions = ['onsite_conversion.messaging_conversation_started_7d', 'messaging_conversation_started_7d', 'messaging_first_reply']
        lead_actions = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'leadgen_grouped']
        thruplay_actions = ['video_thruplay_watched_actions', 'thruplay', 'video_thruplay_watched', 'onsite_conversion.video_thruplay_watched_actions']

        for entry in camp_raw:
            ds = entry['date_start']
            name = entry['campaign_name']
            actions = entry.get('actions', [])
            action_types = [a['action_type'] for a in actions]
            stage = classify_campaign(name, action_types)
            
            spend = float(entry.get('spend', 0.0))
            reach = int(entry.get('reach', 0))
            clicks = int(entry.get('clicks', 0))
            impressions = int(entry.get('impressions', 0))
            
            leads = get_action_value(actions, lead_actions)
            messages = get_action_value(actions, msg_actions)
            thruplays = get_action_value(actions, thruplay_actions)
            visits = get_action_value(actions, ['landing_page_view', 'onsite_conversion.landing_page_view'])
            
            # Revisar si thruplay viene como campo separado (frecuente en v19.0+)
            if 'video_thruplay_watched_actions' in entry:
                thru_field = entry['video_thruplay_watched_actions']
                if isinstance(thru_field, list):
                    thruplays_extra = sum(int(a.get('value', 0)) for a in thru_field)
                    thruplays = max(thruplays, thruplays_extra)
            
            # Inicializar mapa diario
            if ds not in daily_map:
                daily_map[ds] = {
                    "date": ds,
                    "messages": 0, "leads": 0, "visits": 0,
                    "msg_spend": 0.0, "lead_spend": 0.0,
                    "total_spend": 0.0, "reach": 0, "clicks": 0, "impressions": 0, "interactions": 0
                }
            
            d = daily_map[ds]
            d["total_spend"] += spend
            d["reach"] += reach
            d["clicks"] += clicks
            d["impressions"] += impressions
            d["visits"] += visits
            d["interactions"] += sum(int(a.get('value', 0)) for a in actions)
            
            if stage == 'Mensajes':
                d["messages"] += messages
                d["msg_spend"] += spend
            elif stage == 'Leads':
                d["leads"] += leads
                d["lead_spend"] += spend


        # Convertir mapa a lista ordenada
        sorted_dates = sorted(daily_map.keys())
        daily_series = []
        acc_messages = 0
        acc_leads = 0
        
        for ds in sorted_dates:
            d = daily_map[ds]
            acc_messages += d["messages"]
            acc_leads += d["leads"]
            
            dt_obj = datetime.strptime(ds, '%Y-%m-%d')
            
            daily_series.append({
                "date": dt_obj.strftime('%d %b'),
                "date_raw": ds,
                "messages": d["messages"],
                "leads": d["leads"],
                "acc_messages": acc_messages,
                "acc_leads": acc_leads,
                "msg_spend": d["msg_spend"],
                "lead_spend": d["lead_spend"],
                "total_spend": d["total_spend"],
                "cost_per_message": round(d["msg_spend"] / d["messages"], 2) if d["messages"] > 0 else 0,
                "cost_per_lead": round(d["lead_spend"] / d["leads"], 2) if d["leads"] > 0 else 0,
                "reach": d["reach"],
                "clicks": d["clicks"],
                "visits": d["visits"],
                "interactions": d["interactions"]
            })

        # Totales Mensuales
        total_m_spend = sum(d["total_spend"] for d in daily_series)
        total_m_messages = sum(d["messages"] for d in daily_series)
        total_m_leads = sum(d["leads"] for d in daily_series)
        total_m_reach = sum(d["reach"] for d in daily_series)
        total_m_clicks = sum(d["clicks"] for d in daily_series)
        total_m_visits = sum(d["visits"] for d in daily_series)
        total_m_interactions = sum(d["interactions"] for d in daily_series)
        

        # Endpoint data final
        output = {
            "status": "success",
            "kpis": {
                "gastoTotal": round(total_m_spend, 2),
                "leadsTotales": total_m_leads,
                "mensajesTotales": total_m_messages,
                "reachTotal": total_m_reach,
                "clicksTotal": total_m_clicks,
                "visitsTotal": total_m_visits,
                "interactionsTotal": total_m_interactions,
                "presupuestoTotal": MONTHLY_BUDGET,
                "presupuestoRestante": round(max(0, MONTHLY_BUDGET - total_m_spend), 2),
                "costoPorLead": round(sum(d["lead_spend"] for d in daily_series) / total_m_leads, 2) if total_m_leads > 0 else 0,
                "costoPorMensaje": round(sum(d["msg_spend"] for d in daily_series) / total_m_messages, 2) if total_m_messages > 0 else 0
            },
            "daily_series": daily_series,
            "monthDays": ultimo_dia
        }

        # Guardar en Cache
        CACHE[cache_key] = (output, time.time())
        
        return jsonify(output)

    except Exception as e:
        print(traceback.format_exc())
        return jsonify({"status": "error", "message": f"Dashboard Engine Failure: {str(e)}"})

@app.route('/api/today')
def get_today_metrics():
    # Similar a get_dashboard_data pero solo hoy
    now = get_peru_now()
    hoy_ptr = now.strftime('%Y-%m-%d')
    url = f"https://graph.facebook.com/v19.0/{AD_ACCOUNT_ID}/insights"
    
    params = {
        'access_token': ACCESS_TOKEN,
        'level': 'campaign',
        'fields': 'campaign_name,spend,actions,reach,impressions,clicks,video_thruplay_watched_actions',
        'time_range': json.dumps({"since": hoy_ptr, "until": hoy_ptr}),
    }
    
    try:
        res = requests.get(url, params=params, timeout=15).json()
        data = res.get('data', [])
        
        msg_actions = ['onsite_conversion.messaging_conversation_started_7d', 'messaging_conversation_started_7d', 'messaging_first_reply']
        lead_actions = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'leadgen_grouped']

        total_spend = 0
        total_leads = 0
        total_messages = 0
        lead_spend = 0
        msg_spend = 0
        total_imp = 0
        total_clicks = 0

        for camp in data:
            actions = camp.get('actions', [])
            action_types = [a['action_type'] for a in actions]
            stage = classify_campaign(camp['campaign_name'], action_types)
            spend = float(camp.get('spend', 0))
            imp = int(camp.get('impressions', 0))
            clicks = int(camp.get('clicks', 0))
            
            total_spend += spend
            total_imp += imp
            total_clicks += clicks
            
            if stage == 'Leads':
                total_leads += get_action_value(actions, lead_actions)
                lead_spend += spend
            elif stage == 'Mensajes':
                total_messages += get_action_value(actions, msg_actions)
                msg_spend += spend

        return jsonify({
            "status": "success",
            "data": {
                "spend": round(total_spend, 2),
                "leads": total_leads,
                "messages": total_messages,
                "cpl": round(lead_spend / total_leads, 2) if total_leads > 0 else 0,
                "cpm": round(msg_spend / total_messages, 2) if total_messages > 0 else 0,
                "ctr": round((total_clicks / total_imp * 100), 2) if total_imp > 0 else 0,
                "cpm_avg": round((total_spend / (total_imp / 1000)), 2) if total_imp > 0 else 0
            }
        })
    except:
        return jsonify({"status": "error"})

# Global cache for pipeline data
pipeline_cache = {
    "data": None,
    "timestamp": 0
}
CACHE_DURATION = 300 # 5 minutes

@app.route('/api/pipeline')
def get_pipeline_data():
    global pipeline_cache
    
    # Check cache
    now = time.time()
    if pipeline_cache["data"] and (now - pipeline_cache["timestamp"]) < CACHE_DURATION:
        return jsonify(pipeline_cache["data"])

    ghl_token = os.environ.get('GHL_PRIVATE_TOKEN')
    ghl_location = os.environ.get('GHL_LOCATION_ID')
    ghl_version = os.environ.get('GHL_API_VERSION', '2021-07-28')

    if not ghl_token or not ghl_location:
        return jsonify({"status": "error", "message": "GHL credentials not found"})

    headers = {
        "Authorization": f"Bearer {ghl_token}",
        "Version": ghl_version,
        "Accept": "application/json"
    }

    try:
        pip_url = f"https://services.leadconnectorhq.com/opportunities/pipelines?locationId={ghl_location}"
        res_pip = requests.get(pip_url, headers=headers).json()
        pipelines = res_pip.get('pipelines', [])
        
        if not pipelines:
            return jsonify({"status": "error", "message": "No pipelines found"})
            
        # Target the main pipeline for the stats structure
        main_pipeline = next((p for p in pipelines if p['id'] == 'U6LW97fklCl7u6AZUytf'), pipelines[0])
        
        # Build a global map of ALL stages from ALL pipelines to avoid "Otro"
        full_stage_map = {}
        for p in pipelines:
            for s in p.get('stages', []):
                full_stage_map[s.get('id')] = s.get('name')
        
        # We'll use these specific names for the dashboard order/structure
        main_stage_names = [s.get('name') for s in main_pipeline.get('stages', [])]
        
        # 3. Parallel Stage Fetching for Speed and Accuracy
        pipeline_stats = {name: 0 for name in main_stage_names}
        all_processed_today = []
        new_leads_today = 0
        scheduled_leads = 0
        won_leads = 0
        lost_leads = 0
        
        PERU_TZ = pytz.timezone('America/Lima')
        now_peru = datetime.now(PERU_TZ)
        today_str = now_peru.strftime('%Y-%m-%d')

        from concurrent.futures import ThreadPoolExecutor

        def fetch_stage_data(stage_info):
            stage_id, stage_name = stage_info
            if stage_name not in pipeline_stats:
                return []
                
            found_today = []
            next_page_url = f"https://services.leadconnectorhq.com/opportunities/search?location_id={ghl_location}&pipeline_stage_id={stage_id}&limit=100&status=open"
            
            # Fetch up to 10 pages for high-priority stages, fewer for others
            max_pages = 10 if ('cita' in stage_name.lower() or 'agendo' in stage_name.lower() or 'registro' in stage_name.lower()) else 3
            
            for _ in range(max_pages):
                try:
                    resp = requests.get(next_page_url, headers=headers, timeout=10)
                    if resp.status_code != 200: break
                    data = resp.json()
                    opps = data.get('opportunities', [])
                    if not opps: break
                    
                    for opp in opps:
                        dates = [opp.get('createdAt'), opp.get('updatedAt'), opp.get('lastStageChangeAt')]
                        is_today = False
                        for d in dates:
                            if d and d[:10] == today_str:
                                is_today = True
                                break
                            if d:
                                try:
                                    dt = datetime.strptime(d[:19], "%Y-%m-%dT%H:%M:%S")
                                    dt_peru = pytz.utc.localize(dt).astimezone(PERU_TZ)
                                    if dt_peru.strftime('%Y-%m-%d') == today_str:
                                        is_today = True
                                        break
                                except: pass
                        
                        if is_today:
                            found_today.append({
                                "id": opp.get('id'),
                                "name": opp.get('name', 'N/A'),
                                "phone": opp.get('phone', 'N/A'),
                                "stage": stage_name,
                                "status": "open",
                                "source": opp.get('source', 'N/A'),
                                "assignedTo": opp.get('assignedTo', 'Sin Asignar'),
                                "createdAt": opp.get('createdAt'),
                                "updatedAt": opp.get('updatedAt')
                            })
                    
                    next_page_url = data.get('meta', {}).get('nextPageUrl')
                    if not next_page_url: break
                except Exception as e:
                    print(f"Error fetching stage {stage_name}: {e}")
                    break
            return found_today

        # Execute parallel fetches
        with ThreadPoolExecutor(max_workers=5) as executor:
            results = list(executor.map(fetch_stage_data, full_stage_map.items()))
            
        for stage_leads in results:
            for lead in stage_leads:
                all_processed_today.append(lead)
                stage_name = lead['stage']
                pipeline_stats[stage_name] += 1
                if 'cita' in stage_name.lower() or 'agendo' in stage_name.lower():
                    scheduled_leads += 1
                if lead['createdAt'] and lead['createdAt'][:10] == today_str:
                    new_leads_today += 1

        # 4. Global fetch for daily metrics (Won, Lost, and NEW Leads)
        # This ensures "Leads Hoy" counts EVERY lead created today, even if not in the main stages
        try:
            res_global = requests.get(f"https://services.leadconnectorhq.com/opportunities/search?location_id={ghl_location}&limit=100&order=updated_desc&status=all", headers=headers, timeout=10).json()
            
            # Reset global counters to use the broad search results
            won_leads = 0
            lost_leads = 0
            new_leads_today_global = 0
            
            for opp in res_global.get('opportunities', []):
                created_at_raw = opp.get('createdAt', '')
                updated_at_raw = opp.get('updatedAt', '')
                status = opp.get('status', 'open')
                
                # Check for creation today (Global Leads Hoy)
                if created_at_raw and created_at_raw[:10] == today_str:
                    new_leads_today_global += 1
                
                # Check for updates today (Won/Lost)
                if updated_at_raw and updated_at_raw[:10] == today_str:
                    if status == 'won': won_leads += 1
                    if status == 'lost': lost_leads += 1
            
            # Use the global count if it's higher than the stage-specific count
            new_leads_today = max(new_leads_today, new_leads_today_global)
        except: pass

        # Deduplicate and sort
        seen_ids = set()
        final_list = []
        for o in all_processed_today:
            if o['id'] not in seen_ids:
                final_list.append(o)
                seen_ids.add(o['id'])
        
        final_list.sort(key=lambda x: x['updatedAt'], reverse=True)

        response_data = {
            "status": "success",
            "data": {
                "totalActive": sum(pipeline_stats.values()),
                "newToday": new_leads_today,
                "scheduled": scheduled_leads,
                "won": won_leads,
                "lost": lost_leads,
                "stages": [{"name": k, "count": v} for k, v in pipeline_stats.items()],
                "opportunities": final_list
            }
        }
        
        # Update cache
        pipeline_cache = {
            "data": response_data,
            "timestamp": time.time()
        }

        return jsonify(response_data)

    except Exception as e:
        print(f"Error en get_pipeline_data: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
