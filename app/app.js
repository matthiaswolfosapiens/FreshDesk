
document.addEventListener('DOMContentLoaded', () => {
  /**
   * Initializes the Freshworks client object and sets up the event listener for the modal button.
   */
  async function init() {
    try {
      const client = await app.initialized();
      const openModalBtn = document.getElementById('open-modal-btn');

      openModalBtn.addEventListener('click', () => {
        client.interface.trigger("showModal", {
          title: "AI Assistant",
          template: "modal.html",
          // You can pass data to the modal if needed, for example the ticket ID
          // data: { ticketId: ticket.id }
        }).catch(error => {
          console.error("Failed to open modal", error);
          // Show a user-facing notification on failure
          client.interface.trigger("showNotify", {
            type: "danger",
            message: "Could not open the assistant modal."
          });
        });
      });

    } catch (error) {
      console.error("App initialization failed", error);
      // App init itself failed, so client might not be available. A console log is the only option.
    }
  }

  init();
});