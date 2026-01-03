import React, { useState, useEffect, useRef } from 'react';
import { Field } from 'react-final-form';
import classNames from 'classnames';
import debounce from 'lodash/debounce';
import { ValidationError } from '../../components';

import css from './BankSearchInput.module.css';

const DEBOUNCE_WAIT_TIME = 300;

const BankSearchInputComponent = props => {
  const {
    rootClassName,
    className,
    id,
    label,
    input,
    meta,
    banks = [],
    onSearch,
    disabled,
    placeholder,
    ...rest
  } = props;

  const [searchValue, setSearchValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  const { value, onChange } = input;
  const { touched, error } = meta;
  const hasError = !!(touched && error);

  const selectedBank = banks.find(bank => bank.code === value);

  useEffect(() => {
    if (value) {
      setSearchValue(selectedBank?.name || '');
    }
  }, [value, selectedBank?.name]);

  // Handle input change
  const handleInputChange = e => {
    const newValue = e.target.value;
    setSearchValue(newValue);
    setShowDropdown(true);
    setHighlightedIndex(-1);
  };

  // Handle bank selection
  const handleBankSelect = bank => {
    setSearchValue(bank.name);
    onChange(bank.code);
    setShowDropdown(false);
    setHighlightedIndex(-1);
  };

  const filteredBanks = searchValue
    ? banks.filter(
        bank =>
          bank.name.toLowerCase().includes(searchValue.toLowerCase()) ||
          bank.code.toLowerCase().includes(searchValue.toLowerCase())
      )
    : banks;

  // Handle keyboard navigation
  const handleKeyDown = e => {
    if (!showDropdown || filteredBanks.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev < filteredBanks.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      handleBankSelect(filteredBanks[highlightedIndex]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setHighlightedIndex(-1);
    }
  };

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = event => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        inputRef.current &&
        !inputRef.current.contains(event.target)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Handle focus
  const handleFocus = () => {
    setShowDropdown(true);
  };

  const classes = classNames(rootClassName || css.root, className);
  const inputClasses = classNames(css.input, {
    [css.inputError]: hasError,
  });

  return (
    <div className={classes}>
      {label ? <label htmlFor={id}>{label}</label> : null}
      <div className={css.inputWrapper}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          className={inputClasses}
          value={searchValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder || 'Search for a bank...'}
          autoComplete="off"
          {...rest}
        />
        {showDropdown && filteredBanks.length > 0 && (
          <div ref={dropdownRef} className={css.dropdown}>
            <ul className={css.dropdownList}>
              {filteredBanks.map((bank, index) => (
                <li
                  key={bank.id || bank.code}
                  className={classNames(css.dropdownItem, {
                    [css.highlighted]: index === highlightedIndex,
                  })}
                  onMouseDown={e => {
                    e.preventDefault();
                    handleBankSelect(bank);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  <div className={css.bankName}>{bank.name}</div>
                  {bank.code && <div className={css.bankCode}>{bank.code}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {hasError && <ValidationError fieldMeta={{ touched: true, error }} />}
    </div>
  );
};

/**
 * Bank search input component for Final Form
 *
 * @component
 * @param {Object} props
 * @param {string} props.name - Field name
 * @param {Array} props.banks - Array of bank objects with {id, code, name}
 * @param {Function} props.onSearch - Optional callback when searching
 * @returns {JSX.Element}
 */
const BankSearchInput = props => {
  return <Field component={BankSearchInputComponent} {...props} />;
};

export default BankSearchInput;
