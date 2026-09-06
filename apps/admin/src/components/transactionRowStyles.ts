// MUI theme tokens keep text readable; status and action cells retain their own colors.
const contentCells='& .MuiDataGrid-cell:not([data-field="status"]):not([data-field="actions"]):not([data-field="detail"])';
export const transactionRowStyles={
 '& .transaction-pending':{[contentCells]:{color:'text.secondary'}},
 '& .transaction-error':{[contentCells]:{color:'error.dark','& .MuiTypography-root, & a':{color:'inherit'}}},
 '& .transaction-reversed':{[contentCells]:{color:'text.secondary'},
  '& [data-field="merchant"], & [data-field="description"], & [data-field="cardId"], & [data-field="originalCurrency"], & [data-field="original"], & [data-field="amountCents"], & [data-field="amount"]':{textDecoration:'line-through'}},
};
