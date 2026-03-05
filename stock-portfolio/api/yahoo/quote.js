export default async function handler(req, res) {
    const { ticker } = req.query;
    if (!ticker) {
        return res.status(400).json({ error: 'Ticker is required' });
    }

    try {
        const targetUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2d`;
        const response = await fetch(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: `Failed to fetch quote: ${response.statusText}` });
        }

        const data = await response.json();
        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching quote:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
