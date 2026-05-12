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
CLIENT_NAME = os.environ.get('CLIENT_NAME', 'ALUCINANDO DASHBOARD')
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
    return sum(int(a.get('value', 0)) for a in actions if a.get('action_type') in types)

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
        campaign_map = {} # campaign_name -> total_metrics

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
                    "messages": 0, "leads": 0,
                    "msg_spend": 0.0, "lead_spend": 0.0,
                    "total_spend": 0.0, "reach": 0, "clicks": 0, "impressions": 0, "interactions": 0
                }
            
            d = daily_map[ds]
            d["total_spend"] += spend
            d["reach"] += reach
            d["clicks"] += clicks
            d["impressions"] += impressions
            d["interactions"] += sum(int(a.get('value', 0)) for a in actions)
            
            if stage == 'Mensajes':
                d["messages"] += messages
                d["msg_spend"] += spend
            elif stage == 'Leads':
                d["leads"] += leads
                d["lead_spend"] += spend

            # Acumular para Tabla de Campañas
            if name not in campaign_map:
                campaign_map[name] = {
                    "name": name, "objective": entry.get('objective'), "stage": stage,
                    "spend": 0, "results": 0, "reach": 0, "clicks": 0, "impressions": 0,
                    "ctr_sum": 0, "cpm_sum": 0, "count": 0
                }
            c = campaign_map[name]
            c["spend"] += spend
            
            # Lógica de resultados por etapa
            if stage == 'Mensajes':
                c["results"] += messages
            elif stage == 'Leads':
                c["results"] += leads
            else: # Posicionamiento
                c["results"] += (thruplays if thruplays > 0 else reach)
            c["reach"] += reach
            c["clicks"] += clicks
            c["impressions"] += impressions
            c["ctr_sum"] += float(entry.get('inline_link_click_ctr', 0))
            c["cpm_sum"] += float(entry.get('cpm', 0))
            c["count"] += 1

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
                "interactions": d["interactions"]
            })

        # Totales Mensuales
        total_m_spend = sum(d["total_spend"] for d in daily_series)
        total_m_messages = sum(d["messages"] for d in daily_series)
        total_m_leads = sum(d["leads"] for d in daily_series)
        total_m_reach = sum(d["reach"] for d in daily_series)
        total_m_clicks = sum(d["clicks"] for d in daily_series)
        total_m_interactions = sum(d["interactions"] for d in daily_series)
        
        # Campañas Procesadas
        processed_campaigns = []
        for name, c in campaign_map.items():
            processed_campaigns.append({
                "name": name,
                "objective": c["objective"],
                "stage": c["stage"],
                "spend": round(c["spend"], 2),
                "results": c["results"],
                "result_type": c["stage"],
                "cost_per_result": round(c["spend"] / c["results"], 2) if c["results"] > 0 else 0,
                "ctr": round(c["ctr_sum"] / c["count"], 2) if c["count"] > 0 else 0,
                "cpc": round(c["spend"] / c["clicks"], 2) if c["clicks"] > 0 else 0,
                "cpm": round(c["cpm_sum"] / c["count"], 2) if c["count"] > 0 else 0
            })

        # Endpoint data final
        output = {
            "status": "success",
            "kpis": {
                "gastoTotal": round(total_m_spend, 2),
                "leadsTotales": total_m_leads,
                "mensajesTotales": total_m_messages,
                "reachTotal": total_m_reach,
                "clicksTotal": total_m_clicks,
                "interactionsTotal": total_m_interactions,
                "presupuestoTotal": MONTHLY_BUDGET,
                "presupuestoRestante": round(max(0, MONTHLY_BUDGET - total_m_spend), 2),
                "costoPorLead": round(sum(d["lead_spend"] for d in daily_series) / total_m_leads, 2) if total_m_leads > 0 else 0,
                "costoPorMensaje": round(sum(d["msg_spend"] for d in daily_series) / total_m_messages, 2) if total_m_messages > 0 else 0
            },
            "daily_series": daily_series,
            "campaigns": sorted(processed_campaigns, key=lambda x: x['spend'], reverse=True),
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

if __name__ == '__main__':
    app.run(debug=True, port=5000)
