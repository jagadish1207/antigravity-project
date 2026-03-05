export default async function handler(req, res) {
    const { q } = req.query;
    if (!q) {
        return res.status(400).json({ error: 'Query parameter q is required' });
    }

    try {
        const targetUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
        const response = await fetch(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0"
            }
        });

        if (!response.ok) {
            return res.status(response.status).send(`Failed to fetch news: ${response.statusText}`);
        }

        const xmlText = await response.text();
        res.setHeader('Content-Type', 'application/xml');
        res.status(200).send(xmlText);
    } catch (error) {
        console.error('Error fetching news:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
