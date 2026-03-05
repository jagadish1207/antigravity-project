import urllib.request
import urllib.error
import ssl

context = ssl._create_unverified_context()

def try_url(url):
    print(f"Testing {url} ...")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        response = urllib.request.urlopen(req, context=context)
        data = response.read()
        print(f"Success! Received {len(data)} bytes.\n")
    except Exception as e:
        print(f"Failed: {e}\n")

print("--- Testing Proxies ---")

# 1. Google Finance proxy alternative (via a common free proxy)
try_url('https://api.allorigins.win/raw?url=https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS')

# 2. specific free yfinance api 
try_url('https://yahoo-finance-api.vercel.app/RELIANCE.NS')

# 3. YF without cors (corsproxy)
try_url('https://corsproxy.io/?https://query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS')

# 4. Another cors proxy
try_url('https://api.codetabs.com/v1/proxy?quest=https://query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS')
