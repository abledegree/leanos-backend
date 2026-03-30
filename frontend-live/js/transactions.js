let transactions = loadTransactions();

function addTransaction(type, data) {
    const tx = {
        id: crypto.randomUUID(),
        type,
        timestamp: new Date(),
        ...data
    };

    transactions.push(tx);
    saveTransactions(transactions);
}

function renderTransactions() {
    if (!transactionList) return;

    transactionList.innerHTML = "";

    let filteredTransactions = [...transactions];

    const searchQuery = transactionSearchInput
        ? transactionSearchInput.value.trim().toLowerCase()
        : "";

    if (searchQuery) {
        filteredTransactions = filteredTransactions.filter(tx => {
            const haystack = [
                tx.type,
                tx.itemGroup,
                tx.itemName,
                tx.itemCode,
                tx.jobTicket,
                tx.note,
                tx.unit
            ].join(" ").toLowerCase();

            return haystack.includes(searchQuery);
        });
    }

    if (filteredTransactions.length === 0) {
        transactionList.innerHTML = `<div class="muted">No matching transactions</div>`;
        return;
    }

    const sorted = [...filteredTransactions].sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    for (const tx of sorted) {
        transactionList.innerHTML += `
            <div class="row-card">
                <div class="row-main">
                    <div class="row-title">${escapeHtml(tx.type)}</div>
                    <div class="row-meta">${new Date(tx.timestamp).toLocaleString()}</div>
                </div>
                <div class="row-details">
                    ${tx.itemGroup ? `<strong>Group:</strong> ${escapeHtml(tx.itemGroup)}<br>` : ""}
                    ${tx.itemName ? `<strong>Item:</strong> ${escapeHtml(tx.itemName)}<br>` : ""}
                    ${tx.itemCode ? `<strong>Item ID:</strong> ${escapeHtml(tx.itemCode)}<br>` : ""}
                    ${tx.qty ? `<strong>Qty:</strong> ${tx.qty} ${escapeHtml(tx.unit || "")}<br>` : ""}
                    ${tx.jobTicket ? `<strong>Job:</strong> ${escapeHtml(tx.jobTicket)}<br>` : ""}
                    ${tx.note ? `<strong>Note:</strong> ${escapeHtml(tx.note)}<br>` : ""}
                </div>
            </div>
        `;
    }
}
