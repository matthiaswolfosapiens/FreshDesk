document.addEventListener('DOMContentLoaded', () => {
  const chatHistoryEl = document.getElementById('chat-history');
  const chatForm = document.getElementById('chat-form');
  const userInputEl = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  const useTicketContextCheckbox = document.getElementById('use-ticket-context');
  const productTypesContainer = document.getElementById('product-types-container');
  const chatHistory = [];

  function renderMessage(sender, text) {
    const div = document.createElement('div');
    div.className = `message ${sender}-message`;
    div.textContent = text;
    chatHistoryEl.appendChild(div);
    chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
  }

  function showLoading(isLoading) {
    if (sendButton) sendButton.disabled = isLoading;
    const loadingDiv = document.getElementById('loading');
    if (isLoading && !loadingDiv) {
      const div = document.createElement('div');
      div.id = 'loading';
      div.className = 'message loading-indicator';
      div.textContent = 'Assistant is thinking...';
      chatHistoryEl.appendChild(div);
      chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
    } else if (!isLoading && loadingDiv) {
      loadingDiv.remove();
    }
  }

  function safeParseResponse(resp) {
    try {
      if (!resp) return null;
      if (typeof resp === 'string') return JSON.parse(resp);
      if (resp.response && typeof resp.response === 'string') return JSON.parse(resp.response);
      return resp;
    } catch {
      return null;
    }
  }

  // This function does not use await inside, so no need to be async
  async function invokeRequest(client, method, url, headers = {}, body = null) {
    const options = {
      url,
      method,
      headers
    };
    if (body) options.body = body;

    return await client.request.invoke(options);
  }

  async function fetchTicketContext(client) {
    try {
      const data = await client.data.get('ticket');
      if (data?.ticket) {
        const subject = data.ticket.subject || '';
        const desc = data.ticket.description_text || data.ticket.description || '';
        return `Ticket Context:\nSubject: ${subject}\nDescription: ${desc}\n---\nQuestion:`;
      }
    } catch (e) {
      console.warn('Ticket context not available:', e);
    }
    return '';
  }

  async function loadProductTypes(client, backendUrl, apiKey) {
    const url = `${backendUrl}/product-types`;
    const headers = {
      Authorization: `Bearer ${apiKey}`
    };
    const resp = await invokeRequest(client, 'GET', url, headers);
    const parsed = safeParseResponse(resp) || [];
    const productArray = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.productTypes) ? parsed.productTypes : []);

    productTypesContainer.innerHTML = '';
    productArray.forEach(pt => {
      const div = document.createElement('div');
      div.className = 'product-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `pt-${pt}`;
      checkbox.value = pt;

      const label = document.createElement('label');
      label.htmlFor = `pt-${pt}`;
      label.textContent = pt;

      div.appendChild(checkbox);
      div.appendChild(label);
      productTypesContainer.appendChild(div);
    });
  }

  async function queryBackend(client, backendUrl, apiKey, payload) {
    const url = `${backendUrl}/query`;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    const body = JSON.stringify(payload);
    const resp = await invokeRequest(client, 'POST', url, headers, body);
    const parsed = safeParseResponse(resp);
    return parsed?.answer || parsed?.data?.answer || 'No answer returned from backend';
  }

  async function onFormSubmit(event, client, backendUrl, apiKey) {
    event.preventDefault();

    const userQuery = userInputEl.value.trim();
    if (!userQuery) return;

    renderMessage('user', userQuery);
    userInputEl.value = '';
    showLoading(true);

    try {
      const context = useTicketContextCheckbox.checked ? await fetchTicketContext(client) : '';
      const selectedProductTypes = Array.from(
          productTypesContainer.querySelectorAll('input[type="checkbox"]:checked')
      ).map(cb => cb.value);

      const payload = {
        user_query: `${context} ${userQuery}`.trim(),
        chat_history: chatHistory.slice(-4),
        product_types_to_search: selectedProductTypes
      };

      const answer = await queryBackend(client, backendUrl, apiKey, payload);
      renderMessage('assistant', answer);
      chatHistory.push({ question: userQuery, answer });
    } catch (error) {
      console.error('Backend query failed:', error);
      renderMessage('error', `Error calling backend: ${error.message || error}`);
    } finally {
      showLoading(false);
    }
  }

  async function initApp() {
    const client = await app.initialized();
    const params = await client.iparams.get();
    const backendUrl = params.backend_url;
    const apiKey = params.api_key;

    if (!backendUrl) {
      renderMessage('error', 'Backend URL is not configured in iparams.');
      return;
    }

    try {
      await loadProductTypes(client, backendUrl, apiKey);
      chatForm.addEventListener('submit', (e) => onFormSubmit(e, client, backendUrl, apiKey));
    } catch (error) {
      console.error('Initialization failed:', error);
      renderMessage('error', `Initialization failed: ${error.message || error}`);
    }
  }

  initApp();
});
