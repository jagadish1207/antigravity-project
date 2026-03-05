const https = require('https');

// Test if we can fetch Yahoo Finance via yfinance proxy API instead
const url = 'https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS';
const proxyUrl = 'https://yahoo-finance-api.vercel.app/api/yahoo/finance/chart/RELIANCE.NS';

https.get(proxyUrl, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log(res.statusCode);
        if (data.length > 200) {
            console.log('Success, received data > 200 bytes');
        } else {
            console.log(data);
        }
    });
}).on('error', err => {
    console.log('Error: ', err.message);
});
