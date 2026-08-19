'use strict';

const oracle = require('./oracle.cjs');

const baseExpectedRecommendations = oracle.expectedRecommendations;

oracle.expectedRecommendations = function expectedTwoHourPeakRecommendations(...args) {
  return baseExpectedRecommendations(...args).map((card) => {
    if (
      card.tag !== 'Beobachtung' ||
      !String(card.title || '').includes('wiederholter persönlicher Vergleich')
    ) {
      return card;
    }

    return {
      ...card,
      finding: String(card.finding || '')
        .replace('Peak-Anstieg', '2-h-Peak-Anstieg')
        .replace(/ min\.$/, ' min innerhalb der ersten 120 Minuten.'),
    };
  });
};
