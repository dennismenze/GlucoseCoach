'use strict';

const oracle = require('./oracle.cjs');

const baseExpectedRecommendations = oracle.expectedRecommendations;

oracle.expectedRecommendations = function expectedTwoHourPeakRecommendations(...args) {
  return baseExpectedRecommendations(...args).map((card) => {
    const finding = String(card.finding || '');
    if (!finding.includes('Peak-Anstieg')) return card;

    return {
      ...card,
      finding: finding
        .replace('Peak-Anstieg', '2-h-Peak-Anstieg')
        .replace(/ min\.$/, ' min innerhalb der ersten 120 Minuten.'),
    };
  });
};
