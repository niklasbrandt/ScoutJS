/**
 * Mock Scraper Example
 * @type {import('../../types.d.ts').ScraperPlugin}
 */
export default async function mockScraper(config) {
  console.log('Running mock scraper with config:', config.scraper);
  
  // Return some dummy items
  return [
    {
      id: 'item_' + Date.now() + '_1',
      title: 'Generic Item 1',
      description: 'This is a mocked item for ScoutJS.',
      metadata: { source: 'mock', price: '$100' },
      url: 'https://example.com/item1'
    },
    {
      id: 'item_' + Date.now() + '_2',
      title: 'Generic Item 2',
      description: 'Another mocked item to demonstrate the dashboard.',
      metadata: { source: 'mock', price: '$250' },
      url: 'https://example.com/item2'
    }
  ];
}
