// JIRA Configuration
// Fill in your JIRA connection details below

module.exports = {
    // JIRA base URL (e.g., 'https://jira.your-company.com' or 'https://your-team.atlassian.net')
    baseUrl: process.env.JIRA_BASE_URL || 'https://jira.your-company.com',

    // Authentication: choose ONE method

    // Method 1: JIRA Server/Data Center PAT (Personal Access Token) - preferred
    pat: process.env.JIRA_PAT || '',

    // Method 2: JIRA Cloud (email + API token)
    // Get API token from: https://id.atlassian.com/manage-profile/security/api-tokens
    email: process.env.JIRA_EMAIL || '',
    apiToken: process.env.JIRA_API_TOKEN || '',

    // Method 3: JIRA Server/Data Center (username + password)
    username: process.env.JIRA_USERNAME || '',
    password: process.env.JIRA_PASSWORD || '',

    // JQL query to fetch bugs (modify as needed)
    jql: process.env.JIRA_JQL || 'project in (GPU1, MPW2, BR188, BR200) AND issuetype = Bug AND status not in (Done, Closed, Rejected) ORDER BY priority DESC',

    // Fields to fetch from JIRA
    fields: 'summary,status,assignee,priority,created,updated,labels,issuetype',

    // Max results per request
    maxResults: 100,

    // Whether to auto-close tracker bugs when JIRA bug is closed
    syncClosedStatus: true
};
