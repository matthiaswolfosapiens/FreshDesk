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
      // The response from invokeTemplate is often in resp.response
      if (resp.response && typeof resp.response === 'string') {
        return JSON.parse(resp.response);
      }
      if (typeof resp === 'string') return JSON.parse(resp);
      return resp;
    } catch {
      return null;
    }
  }

  // The generic invokeRequest function is no longer needed.

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

  // Refactored to use the "getProductTypes" template from requests.json
  async function loadProductTypes(client) {
    console.log("entered loadProductTypes");

    const resp = await client.request.invokeTemplate("getProductTypes", {});
    console.log("Response from invokeTemplate:", resp);

    const parsed = safeParseResponse(resp) || [];
    console.log("Parsed product types:", parsed);
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

  // Refactored to use the "postQuery" template from requests.json
  async function queryBackend(client, payload) {
    const options = {
      body: JSON.stringify(payload)
    };

    const resp = await client.request.invokeTemplate("postQuery", options);
    const parsed = safeParseResponse(resp);
    return parsed?.answer || parsed?.data?.answer || 'No answer returned from backend';
  }

  // Refactored to remove the backendUrl parameter
  async function onFormSubmit(event, client) {
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

      const answer = await queryBackend(client, payload);
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
    try {
      console.log('App initialization started...');
      const client = await app.initialized();
      console.log('Client object initialized successfully.');

      console.log('Attempting to get iparams...');
      const params = await client.iparams.get();
      console.log('Successfully retrieved iparams:', params);

      // We keep this check to ensure the app is configured, even though
      // the URL is now used by the template in requests.json.
      if (!params.backend_url) {
        console.error('Backend URL is not configured in iparams.');
        renderMessage('error', 'Backend URL is not configured in iparams.');
        return;
      }
      console.log(`Configuration check passed. Backend URL is: ${params.backend_url}`);

      console.log('Attempting to load product types...');
      await loadProductTypes(client); // backendUrl no longer needed
      console.log('Successfully loaded product types.');

      // backendUrl no longer needed in the event listener
      chatForm.addEventListener('submit', (e) => onFormSubmit(e, client));
      console.log('Form submit event listener added successfully.');
      console.log('App initialization complete!');

    } catch (error) {
      console.error('CRITICAL ERROR during initialization:', error);
      renderMessage('error', `Initialization failed: ${error.message || error}`);
    }
  }

  initApp();
});