import 'https://cdn.jsdelivr.net/gh/orestbida/cookieconsent@3.1.0/dist/cookieconsent.umd.js';

CookieConsent.run({

    categories: {
        necessary: {
            enabled: true,
            readOnly: true
        },
        analytics: {
            enabled: false,
            cookies: [
                { name: '_ga' },
                { name: '_ga_4Z9GJND36G' }
            ]
        }
    },

    language: {
        default: 'en',
        translations: {
            en: {
                consentModal: {
                    title: 'We use cookies',
                    description: 'We use Google Analytics to understand how visitors use this site. No personal data is collected.',
                    acceptAllBtn: 'Accept',
                    acceptNecessaryBtn: 'Reject'
                },
                preferencesModal: {
                    title: 'Cookie preferences',
                    acceptAllBtn: 'Accept all',
                    acceptNecessaryBtn: 'Reject all',
                    savePreferencesBtn: 'Save',
                    closeIconLabel: 'Close',
                    sections: [
                        {
                            title: 'Strictly necessary',
                            description: 'Essential for the site to function. Cannot be disabled.',
                            linkedCategory: 'necessary'
                        },
                        {
                            title: 'Analytics',
                            description: 'Google Analytics cookies (_ga, _ga_4Z9GJND36G) to measure audience. Data is anonymized.',
                            linkedCategory: 'analytics'
                        }
                    ]
                }
            }
        },
    },
});