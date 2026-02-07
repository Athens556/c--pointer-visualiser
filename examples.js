/**
 * Example C Code Snippets
 * Pre-built examples for learning pointer concepts
 */

const examples = {
    basic: {
        title: 'Basic Pointer',
        description: 'Simple pointer to an integer',
        code: `#include <stdio.h>

// Basic Pointer Example
// A pointer stores the memory address of another variable

int main() {
    int x = 42;      // Regular integer variable
    int *p = &x;     // Pointer p stores address of x

    // Now *p and x refer to the same memory location
    // Changing *p would change x, and vice versa
    
    return 0;
}`
    },

    double: {
        title: 'Double Pointer',
        description: 'Pointer to a pointer (two levels of indirection)',
        code: `#include <stdio.h>

// Double Pointer Example
// A pointer can point to another pointer

int main() {
    int value = 100;      // The actual value
    int *ptr = &value;    // First level: pointer to value
    int **pptr = &ptr;    // Second level: pointer to pointer

    // Chain: pptr -> ptr -> value
    // *pptr gives ptr, **pptr gives value
    
    return 0;
}`
    },

    array: {
        title: 'Array & Pointer',
        description: 'Arrays decay to pointers - they are closely related',
        code: `#include <stdio.h>

// Array and Pointer Relationship
// Array name is essentially a pointer to first element

int main() {
    int arr[5] = {10, 20, 30, 40, 50};
    int *p = arr;     // p points to arr[0]
    int *q = &arr[0]; // Same as above

    // arr, p, and q all point to the same location
    // p[0] is same as arr[0] is same as *p
    
    return 0;
}`
    },

    struct: {
        title: 'Struct Pointer',
        description: 'Pointers to structures - common in data structures',
        code: `#include <stdio.h>

// Struct Pointer Example
// Pointers to structs use -> operator for member access

struct Point {
    int x;
    int y;
};

int main() {
    struct Point origin = {0, 0};
    struct Point *ptr = &origin;

    // Access: ptr->x is same as (*ptr).x
    
    return 0;
}`
    },

    linked: {
        title: 'Linked List',
        description: 'Node structure with self-referential pointer',
        code: `#include <stdio.h>
#include <stdlib.h>

// Linked List Node Example
// Each node contains data and pointer to next node

struct Node {
    int data;
    struct Node *next;
};

int main() {
    struct Node node1;
    struct Node node2;
    struct Node node3;

    node1.data = 10;
    node2.data = 20;
    node3.data = 30;

    struct Node *head = &node1;
    node1.next = &node2;
    node2.next = &node3;
    node3.next = NULL;

    // Chain: head -> node1 -> node2 -> node3 -> NULL
    
    return 0;
}`
    },

    swap: {
        title: 'Pointer Swap',
        description: 'Using pointers to swap values',
        code: `#include <stdio.h>

// Swapping Values with Pointers
// Pointers allow functions to modify caller's variables

int main() {
    int a = 5;
    int b = 10;
    int *pa = &a;
    int *pb = &b;

    // Swap using pointers
    int temp = *pa;
    *pa = *pb;
    *pb = temp;
    
    return 0;
}`
    },

    string: {
        title: 'String Pointer',
        description: 'Character arrays and string pointers',
        code: `#include <stdio.h>

// String and Char Pointer Example
// Strings in C are char arrays, often accessed via pointers

int main() {
    char str[6] = "Hello";
    char *s = str;

    // s points to 'H', the first character
    // s[0] = 'H', s[1] = 'e', etc.
    // *(s+1) is same as s[1]
    
    return 0;
}`
    },

    function: {
        title: 'Function Pointer',
        description: 'Pointers that store function addresses',
        code: `#include <stdio.h>

// Function Pointer Example
// Functions can be pointed to and called via pointers

int add(int a, int b) {
    return a + b;
}

int main() {
    int (*operation)(int, int) = &add;

    // Call: int result = operation(5, 3);
    // result would be 8
    int result = operation(5, 3);
    
    return 0;
}`
    }
};

// Export for use
window.cExamples = examples;
