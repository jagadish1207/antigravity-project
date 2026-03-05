export default async function handler(req, res) {
    const { q } = req.query;
    if (!q) {
        return res.status(400).json({ error: 'Query parameter q is required' });
    }

    try {
        const targetUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&newsCount=0&enableFuzzyQuery=false&enableCb=false`;
        const response = await fetch(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: `Failed to search symbol: ${response.statusText}` });
        }

        const data = await response.json();
        res.status(200).json(data);
    } catch (error) {
        console.error('Error searching symbol:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
