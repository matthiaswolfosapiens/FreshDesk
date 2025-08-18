
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
        }).catch(error => {
          console.error("Failed to open modal", error);
          client.interface.trigger("showNotify", {
            type: "danger",
            message: "Could not open the assistant modal."
          });
        });
      });

    } catch (error) {
      console.error("App initialization failed", error);
    }
  }

  init();
});