document.addEventListener('DOMContentLoaded', function () {
  // --- DOM Elements ---
  const chatHistoryEl = document.getElementById('chat-history');
  const chatForm = document.getElementById('chat-form');
  const userInputEl = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  const useTicketContextCheckbox = document.getElementById('use-ticket-context');
  const productTypesContainer = document.getElementById('product-types-container');

  // Verwende 'const' für Variablen, die nicht neu zugewiesen werden.
  const chatHistory = [];

  // --- Utility Functions to render UI ---
  function renderMessage(sender, text) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `${sender}-message`);
    messageDiv.textContent = text;
    chatHistoryEl.appendChild(messageDiv);
    chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
  }

  function showLoading(isLoading) {
    sendButton.disabled = isLoading;
    const existingLoadingDiv = document.getElementById('loading');
    if (isLoading && !existingLoadingDiv) {
      const loadingDiv = document.createElement('div');
      loadingDiv.classList.add('message', 'loading-indicator');
      loadingDiv.id = 'loading';
      loadingDiv.textContent = 'Assistant is thinking...';
      chatHistoryEl.appendChild(loadingDiv);
      chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
    } else if (!isLoading && existingLoadingDiv) {
      existingLoadingDiv.remove();
    }
  }

  // --- App Logic Functions ---
  async function loadProductTypes() {
    try {
      // ALTE API-Syntax für GET
      const data = await client.request.get(`${backendUrl}/product-types`);
      const productTypes = JSON.parse(data.response);
      productTypesContainer.innerHTML = '';
      productTypes.forEach(pt => {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('product-item');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `pt-${pt}`;
        checkbox.value = pt;
        const label = document.createElement('label');
        label.htmlFor = `pt-${pt}`;
        label.textContent = pt;
        itemDiv.appendChild(checkbox);
        itemDiv.appendChild(label);
        productTypesContainer.appendChild(itemDiv);
      });
    } catch (error) {
      console.error('Failed to load product types:', error);
      renderMessage('error', `Could not load product areas. Error: ${error.message}`);
    }
  }

  async function handleFormSubmit(event) {
    event.preventDefault();
    const userQuery = userInputEl.value.trim();
    if (!userQuery) return;

    renderMessage('user', userQuery);
    userInputEl.value = '';
    showLoading(true);

    let context = "";
    if (useTicketContextCheckbox.checked) {
      try {
        const ticketData = await client.data.get('ticket');
        const { subject, description_text } = ticketData.ticket;
        context = `Ticket Context:\nSubject: ${subject}\nDescription: ${description_text}\n---\nQuestion:`;
      } catch (error) {
        console.error("Error fetching ticket data:", error);
      }
    }

    const fullQuery = `${context} ${userQuery}`;
    const selectedCheckboxes = document.querySelectorAll('#product-types-container input[type="checkbox"]:checked');
    const selectedProductTypes = Array.from(selectedCheckboxes).map(cb => cb.value);

    const payload = {
      user_query: fullQuery,
      chat_history: chatHistory.slice(-4),
      product_types_to_search: selectedProductTypes
    };

    const options = {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    };

    try {
      const data = await client.request.post(`${backendUrl}/query`, options);
      const response = JSON.parse(data.response);
      renderMessage('assistant', response.answer);
      chatHistory.push({ question: userQuery, answer: response.answer });
    } catch (error) {
      console.error("Error calling backend:", error);
      renderMessage('error', `Error: ${error.message}. Is the backend running?`);
    } finally {
      showLoading(false);
    }
  }

  app.initialized().then(_client => {
    client = _client;
    client.iparams.get().then(params => {
      backendUrl = params.backend_url;
      apiKey = params.api_key;
      loadProductTypes();
      chatForm.addEventListener('submit', handleFormSubmit);
    }).catch(err => renderMessage('error', 'Could not load app configuration.'));
  }).catch(err => renderMessage('error', 'Could not initialize the app.'));
});