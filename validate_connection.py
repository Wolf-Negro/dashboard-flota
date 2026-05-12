import os
import requests
import json
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

ACCESS_TOKEN = os.environ.get('META_ACCESS_TOKEN')
AD_ACCOUNT_ID = os.environ.get('AD_ACCOUNT_ID')

def validate_connection():
    if not AD_ACCOUNT_ID:
        print("Error: AD_ACCOUNT_ID not found in .env")
        return

    url = f"https://graph.facebook.com/v19.0/{AD_ACCOUNT_ID}/insights"
    params = {
        'access_token': ACCESS_TOKEN,
        'level': 'campaign',
        'fields': 'campaign_name,spend,actions,reach,impressions,clicks,inline_link_clicks,video_thruplay_watched_actions',
        'date_preset': 'this_month',
        'limit': '100'
    }
    
    print(f"--- Validating Connection for Account: {AD_ACCOUNT_ID} ---")
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        res_json = response.json()
        data = res_json.get('data', [])
        
        if not data:
            print("No data found for this month.")
            return

        print(f"Found {len(data)} campaigns with data this month.\n")
        
        for campaign in data:
            print(f"Campaign: {campaign.get('campaign_name')}")
            print(f"  Spend: {campaign.get('spend')}")
            print(f"  Reach: {campaign.get('reach')}")
            
            actions = campaign.get('actions', [])
            action_types = [a['action_type'] for a in actions]
            print(f"  Action Types: {action_types}")
            
            leads = next((int(a['value']) for a in actions if a['action_type'] == 'lead'), 0)
            messages = next((int(a['value']) for a in actions if a['action_type'] in ['onsite_conversion.messaging_conversation_started_7d', 'messaging_conversation_started_7d']), 0)
            thruplays = next((int(a['value']) for a in campaign.get('video_thruplay_watched_actions', []) if a['action_type'] == 'video_thruplay_watched_actions'), 0)
            
            print(f"  Leads: {leads}")
            print(f"  Messages: {messages}")
            print(f"  ThruPlays: {thruplays}")
            print("-" * 20)
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    validate_connection()
