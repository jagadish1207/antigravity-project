export default async function handler(req, res) {
    const { ticker, range } = req.query;

    // Validate
    if (!ticker) {
        return res.status(400).json({ error: 'Ticker is required' });
    }

    // Default to 1mo if range not provided
    const validRanges = ['1d', '5d', '1mo', '1y', '5y', 'max'];
    const r = validRanges.includes(range) ? range : '1mo';

    // Determine interval based on range
    let interval = '1d';
    if (r === '1d' || r === '5d') interval = '5m';
    else if (r === '1mo') interval = '1d';
    else if (r === '1y') interval = '1wk';
    else if (r === '5y' || r === 'max') interval = '1mo';

    try {
        const targetUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${r}&interval=${interval}`;
        const response = await fetch(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: `Failed to fetch history: ${response.statusText}` });
        }

        const data = await response.json();

        // Yahoo returns deeply nested JSON, let's extract what we need
        // Timestamps are in UNIX seconds
        const result = data?.chart?.result?.[0];
        if (!result) {
            return res.status(404).json({ error: 'No data found' });
        }

        const timestamps = result.timestamp || [];
        const closes = result.indicators?.quote?.[0]?.close || [];

        // Filter out null closes to prevent chart gaps
        const history = [];
        for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] != null) {
                history.push({
                    t: timestamps[i],
                    c: closes[i]
                });
            }
        }

        res.status(200).json(history);
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
